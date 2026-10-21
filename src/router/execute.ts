import { and, eq } from 'drizzle-orm';
import { models, providerLimits } from '@/db/schema';
import { loadCredentials, markInvalid, touchKey } from '@/keys/service';
import { callChat } from '@/providers/client';
import { getProvider, keylessIds } from '@/providers/registry';
import type { Deps } from '@/server/deps';
import { estimateTokens, learnedScores, recentFailures, recordUsage, usageToday } from '@/usage/ledger';
import { detectTask } from './quality';

/** 400s caused by the model, its size limits or a gateway's upstream rather than the request (Groq: "Failed to call
 * a function"; OpenRouter / Kilo: "Provider returned error"). Another model can take them. */
const MODEL_SIDE_400 = /failed to call a function|tool_use_failed|failed_generation|invalid tool call|context.{0,12}(length|window)|maximum context|too many tokens|reduce the length|request too large|prompt is too long|provider returned error|upstream (error|request failed)/i;
import { tapSseUsage } from '@/usage/tap';
import { parseRateHeaders, saveLimits } from '@/usage/limits';
import { isAuto, parseModelRef, selectCandidates, type CatalogModel } from './select';
import { hasImageContent, supportsVision } from './vision';

export interface ChatInput {
  userId: string;
  source: 'chat' | 'api';
  body: Record<string, unknown>;
}

export type RouteOutcome =
  | { ok: true; response: Response }
  | { ok: false; status: number; code: string; message: string };

const cooldownKey = (userId: string, provider: string) => `cd:${userId}:${provider}`;
const fail = (status: number, code: string, message: string): RouteOutcome => ({ ok: false, status, code, message });

export async function routeChat(input: ChatInput, deps: Deps): Promise<RouteOutcome> {
  const now = deps.now ?? Date.now;
  const { userId, source, body } = input;
  const requested = typeof body.model === 'string' && body.model ? body.model : 'auto-smart';

  // Only this user's keys: the hard no-pooling rule lives here.
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);
  const catalog = (await deps.db.select().from(models)) as CatalogModel[];
  // Keyless providers (the built-in starter, Kilo, LLM7) need no key of the user's; they're added when
  // their models are in the catalog and sort after the user's own providers (high priority numbers).
  // A user who adds a key for one of them gets their key used instead.
  const keyless = new Set<string>();
  for (const id of keylessIds()) {
    if (!creds.has(id) && catalog.some((m) => m.provider === id && m.enabled)) {
      creds.set(id, { creds: { key: '', extra: null }, excludedFromAuto: false });
      keyless.add(id);
    }
  }
  if (creds.size === 0) {
    return fail(400, 'no_providers', 'You have no connected providers. Add an API key at /connect.');
  }

  if (!isAuto(requested)) {
    const ref = parseModelRef(requested);
    if (!ref || !catalog.some((m) => m.provider === ref.provider && m.modelId === ref.modelId)) {
      return fail(404, 'model_not_found', `Unknown model "${requested}". Use auto-smart, auto-fast, or a model from /api/v1/models.`);
    }
  }

  const cooling = new Set<string>();
  const resetTimes: number[] = [];
  for (const provider of creds.keys()) {
    const until = await deps.kv.get(cooldownKey(userId, provider));
    if (until) {
      cooling.add(provider);
      resetTimes.push(Number(until));
    }
  }

  const needsVision = hasImageContent(body.messages);
  const promptEstimate = estimateTokens(body.messages);
  // models the provider says are out of requests until their window resets
  const nowMs = now();
  const exhausted = new Set((await deps.db.select().from(providerLimits).where(and(eq(providerLimits.userId, userId), eq(providerLimits.remainingRequests, 0))))
    .filter((l) => !l.requestsResetAt || l.requestsResetAt.getTime() > nowMs).map((l) => `${l.provider}/${l.modelId}`));
  const task = detectTask(body);
  const selectInput = {
    requested,
    models: catalog,
    connected: [...creds].map(([provider, c]) => ({ provider, excludedFromAuto: c.excludedFromAuto })),
    cooling,
    usageToday: await usageToday(deps.db, userId, new Date(now())),
    promptTokens: promptEstimate,
    needsTools: Array.isArray(body.tools) && body.tools.length > 0,
    needsVision,
    canSee: supportsVision,
    task,
    learned: isAuto(requested) ? await learnedScores(deps.db, userId, task, new Date(nowMs - 14 * 86_400_000)) : undefined,
    exhausted,
    recentFailures: await recentFailures(deps.db, userId, new Date(nowMs - 10 * 60_000)),
    keyless,
  };
  const candidates = selectCandidates(selectInput);
  // Empty even with quota ignored: no connected model can serve this request at all.
  if (candidates.length === 0 && selectCandidates({ ...selectInput, cooling: new Set(), usageToday: new Map() }).length === 0) {
    if (needsVision) {
      return fail(400, 'no_vision_model',
        'None of your connected models can see images. Connect Gemini (or a GitHub GPT-4.1 key) at /connect to send pictures.');
    }
    return fail(400, 'no_capable_model',
      'None of your connected models can handle this request (it may need tool support or a longer context window, ' +
      'or every provider is excluded from auto-routing). Connect more providers at /connect.');
  }

  const stream = body.stream === true;
  // Ask for token counts on streams (most providers only send them when asked), unless the client
  // already did; the extra chunk is then stripped so the client sees what it asked for.
  const clientWantsUsage = !!(body.stream_options as { include_usage?: boolean } | undefined)?.include_usage;

  // models tried before the one that answered, and why they didn't (shown to the user by clients)
  const skipped: string[] = [];
  for (const m of candidates) {
    if (cooling.has(m.provider)) continue; // a model of this provider failed earlier in this loop
    const def = getProvider(m.provider);
    const c = creds.get(m.provider);
    if (!def || !c) continue;

    const started = now();
    const usageBase = { userId, provider: m.provider, modelId: m.modelId, source, task };
    const plain = { ...body, model: m.modelId };
    const askUsage = stream && !clientWantsUsage;
    let r = await callChat(def, c.creds, askUsage ? { ...plain, stream_options: { ...(body.stream_options as object), include_usage: true } } : plain, { fetchImpl: deps.fetchImpl });
    // a provider that rejects stream_options: try again exactly as the client sent it
    if (askUsage && !r.ok && r.error.kind === 'bad_request') r = await callChat(def, c.creds, plain, { fetchImpl: deps.fetchImpl });

    if (!r.ok) {
      const e = r.error;
      skipped.push(`${m.provider}/${m.modelId} (${e.kind.replace('_', ' ')})`);
      console.warn(`[router] ${m.provider}/${m.modelId} failed (${e.kind}${'status' in e && e.status ? ` ${e.status}` : ''}): ${String(e.message).slice(0, 300)}`);
      await recordUsage(deps.db, {
        ...usageBase, promptTokens: 0, completionTokens: 0, latencyMs: now() - started,
        status: e.kind === 'rate_limit' ? 'rate_limited' : 'error',
      });
      // a 400 that's really the model's fault (a malformed tool call it generated) or too much for this
      // model's context: another model can take it. Anything else is the request's fault: report it.
      if (e.kind === 'bad_request' && !MODEL_SIDE_400.test(String(e.message))) return fail(e.status, 'upstream_bad_request', e.message);
      if (e.kind === 'bad_request') continue;
      if (e.kind === 'not_found') {
        // Retired/unavailable model: skip just this model, leave the provider's others usable.
        continue;
      }
      if (e.kind === 'auth') {
        await markInvalid(deps.db, userId, m.provider);
      } else {
        const ttl = Math.max(1000, e.kind === 'rate_limit' ? (e.retryAfterMs ?? 60_000) : 30_000);
        await deps.kv.set(cooldownKey(userId, m.provider), String(now() + ttl), ttl);
        resetTimes.push(now() + ttl);
      }
      cooling.add(m.provider);
      continue;
    }

    await touchKey(deps.db, userId, m.provider);
    const live = parseRateHeaders(r.response.headers, now());
    if (live) {
      await saveLimits(deps.db, userId, m.provider, m.modelId, live).catch((err) => console.error('limit save failed', err));
    }
    const headers = {
      'content-type': r.response.headers.get('content-type') ?? (stream ? 'text/event-stream' : 'application/json'),
      'x-freetoken-provider': `${m.provider}/${m.modelId}`,
      // which kind of task auto routing saw, and what it fell back from (clients show which model did what)
      'x-freetoken-task': task,
      ...(skipped.length ? { 'x-freetoken-fallbacks': skipped.join(', ') } : {}),
    };

    if (stream && r.response.body) {
      const tapped = tapSseUsage(r.response.body, ({ usage, completionChars, failed, error }) => {
        if (failed) console.warn(`[router] ${m.provider}/${m.modelId} broke off mid-stream: ${error ?? 'connection lost'}`);
        recordUsage(deps.db, {
          ...usageBase,
          promptTokens: usage?.promptTokens ?? promptEstimate,
          completionTokens: usage?.completionTokens ?? Math.ceil(completionChars / 4),
          status: failed ? 'error' : 'ok',
          latencyMs: now() - started,
          estimated: !usage,
        }).catch((err) => console.error('usage record failed', err));
      }, { stripUsageChunk: !clientWantsUsage });
      return { ok: true, response: new Response(tapped, { status: 200, headers }) };
    }

    let json;
    try {
      json = await r.response.json();
    } catch {
      // A 200 with a non-JSON body (proxy/captive page): nothing sent to the client yet, so fall back.
      await recordUsage(deps.db, { ...usageBase, promptTokens: 0, completionTokens: 0, status: 'error', latencyMs: now() - started });
      await deps.kv.set(cooldownKey(userId, m.provider), String(now() + 30_000), 30_000);
      resetTimes.push(now() + 30_000);
      cooling.add(m.provider);
      continue;
    }
    await recordUsage(deps.db, {
      ...usageBase,
      promptTokens: json.usage?.prompt_tokens ?? promptEstimate,
      completionTokens: json.usage?.completion_tokens ?? 0,
      status: 'ok',
      latencyMs: now() - started,
      estimated: json.usage?.prompt_tokens == null,
    });
    return { ok: true, response: Response.json(json, { headers }) };
  }

  const earliest = resetTimes.length ? Math.min(...resetTimes) : null;
  return fail(
    429,
    'all_providers_exhausted',
    'All your connected providers are out of free quota or unavailable.' +
      (earliest ? ` Earliest retry: ${new Date(earliest).toISOString()}.` : '') +
      ' Connect more providers at /connect to increase your quota.',
  );
}
