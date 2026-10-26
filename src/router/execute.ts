import { and, eq } from 'drizzle-orm';
import { models, providerLimits } from '@/db/schema';
import { loadCredentials, markInvalid, touchKey } from '@/keys/service';
import { callChat } from '@/providers/client';
import { getProvider, keylessIds } from '@/providers/registry';
import type { Deps } from '@/server/deps';
import { peekFirstEvent } from '@/router/peek';
import { estimateTokens, learnedScores, recentFailures, recordUsage, usageToday } from '@/usage/ledger';
import { detectTask, type Task } from './quality';
import { noteReachable, noteUnreachable, unreachableHint } from '@/providers/network';

/** 400s caused by the model, its size limits or a gateway's upstream rather than the request (Groq: "Failed to call
 * a function"; OpenRouter / Kilo: "Provider returned error"; Cloudflare: "AiError: Bad input" for a message format it
 * doesn't take). Another model can take them. */
const MODEL_SIDE_400 = /failed to call a function|AiError: Bad input|unknown name "[^"]+": cannot find field|tool_use_failed|failed_generation|invalid tool call|context.{0,12}(length|window)|maximum context|too many tokens|reduce the length|request too large|prompt is too long|provider returned error|upstream (error|request failed)/i;
import { tapSseUsage } from '@/usage/tap';
import { markExhausted, nextMidnight, parseRateHeaders, saveLimits, saveTokenCap } from '@/usage/limits';
import { isAuto, parseModelRef, selectCandidates, type CatalogModel } from './select';
import { hasImageContent, supportsVision } from './vision';
import { forProvider } from './compat';
import { saveSignatures, signaturesIn, standardizeGeminiAnswer, standardizeGeminiStream, withSignatures } from './gemini';

export interface ChatInput {
  userId: string;
  source: 'chat' | 'api';
  body: Record<string, unknown>;
  /** the kind of task, when the client says (a coding agent asking its planner for a reasoning model) */
  task?: Task;
  /** the client's conversation (x-freetoken-session): auto routing keeps it on the model it's working with */
  session?: string;
}

/** How long a conversation stays on its model after its last answer. */
const PIN_MS = 30 * 60_000;
const pinKey = (userId: string, task: string, session: string) => `pin:${userId}:${task}:${session}`;

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
  // A "0 left" with no reset time counts only for a minute: limits are refreshed only by a successful
  // call to that model, so excluding it until a reset that never comes would block it forever.
  const exhaustedRows = (await deps.db.select().from(providerLimits).where(and(eq(providerLimits.userId, userId), eq(providerLimits.remainingRequests, 0))))
    .filter((l) => (l.requestsResetAt ? l.requestsResetAt.getTime() > nowMs : l.updatedAt.getTime() + 60_000 > nowMs));
  const exhausted = new Set(exhaustedRows.map((l) => `${l.provider}/${l.modelId}`));
  // each model's token allowance per request window, as its provider last reported it
  const tokenCaps = new Map((await deps.db.select().from(providerLimits).where(eq(providerLimits.userId, userId)))
    .filter((l) => l.limitTokens != null && l.limitTokens > 0).map((l) => [`${l.provider}/${l.modelId}`, l.limitTokens!] as const));
  // when they reset: the "try again at" in the all-exhausted answer
  for (const l of exhaustedRows) resetTimes.push(l.requestsResetAt?.getTime() ?? l.updatedAt.getTime() + 60_000);
  const task = input.task ?? detectTask(body);
  const pinAt = isAuto(requested) && input.session ? pinKey(userId, `${requested}:${task}`, input.session) : null;
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
    tokenCaps,
    pinned: pinAt ? (await deps.kv.get(pinAt)) ?? undefined : undefined,
  };
  const candidates = selectCandidates(selectInput);
  // Empty even with quota ignored (cooldowns, daily limits, providers' "none left"): no connected model
  // can serve this request at all. Out of quota is a 429 "try later", never this 400.
  if (candidates.length === 0 && selectCandidates({ ...selectInput, cooling: new Set(), usageToday: new Map(), exhausted: new Set() }).length === 0) {
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
  // providers that couldn't be reached from this network (blocked / no connection) this request
  const unreachable = new Set<string>();
  let otherFailures = 0;
  for (const m of candidates) {
    if (cooling.has(m.provider)) continue; // a model of this provider failed earlier in this loop
    const def = getProvider(m.provider);
    const c = creds.get(m.provider);
    if (!def || !c) continue;

    const started = now();
    const usageBase = { userId, provider: m.provider, modelId: m.modelId, source, task };
    // Gemini refuses earlier tool calls without their thought signatures: put them back
    const plain = forProvider(m.provider, { ...body, model: m.modelId, ...(m.provider === 'gemini' && Array.isArray(body.tools) ? { messages: await withSignatures(deps.kv, userId, body.messages) } : {}) });
    const askUsage = stream && !clientWantsUsage;
    let r = await callChat(def, c.creds, askUsage ? { ...plain, stream_options: { ...(body.stream_options as object), include_usage: true } } : plain, { fetchImpl: deps.fetchImpl });
    // a provider that rejects stream_options: try again exactly as the client sent it
    if (askUsage && !r.ok && r.error.kind === 'bad_request') r = await callChat(def, c.creds, plain, { fetchImpl: deps.fetchImpl });
    // the client asked for it itself (Claude Code / Codex through FreeToken do): if the provider rejects
    // it, try once without it rather than failing the whole request (usage is then estimated)
    else if (!askUsage && body.stream_options && !r.ok && r.error.kind === 'bad_request' && /stream_options|include_usage/i.test(r.error.message)) {
      const withoutOptions: Record<string, unknown> = { ...plain };
      delete withoutOptions.stream_options;
      r = await callChat(def, c.creds, withoutOptions, { fetchImpl: deps.fetchImpl });
    }

    if (!r.ok) {
      const e = r.error;
      skipped.push(`${m.provider}/${m.modelId} (${e.kind.replace('_', ' ')})`);
      if (e.kind === 'network' || e.kind === 'blocked') {
        unreachable.add(m.provider);
        await noteUnreachable(deps.kv, userId, m.provider, { kind: e.kind, message: e.message, at: now() });
      } else otherFailures++;
      console.warn(`[router] ${m.provider}/${m.modelId} failed (${e.kind}${'status' in e && e.status ? ` ${e.status}` : ''}): ${String(e.message).slice(0, 300)}`);
      await recordUsage(deps.db, {
        ...usageBase, promptTokens: 0, completionTokens: 0, latencyMs: now() - started,
        status: e.kind === 'rate_limit' ? 'rate_limited' : 'error',
      });
      // a 400 that's really the model's fault (a malformed tool call it generated) or too much for this
      // model's context: another model can take it. Anything else is the request's fault: report it.
      if (e.kind === 'bad_request' && !MODEL_SIDE_400.test(String(e.message))) return fail(e.status, 'upstream_bad_request', e.message);
      if (e.kind === 'bad_request') continue;
      if (e.kind === 'not_found' || e.kind === 'forbidden') {
        // Retired/unavailable model, or one this key may not use (a 403 that isn't about the key):
        // skip just this model, leave the provider's others — and the key — usable.
        continue;
      }
      // Too big for this one model ("Limit 7000, Requested 10727"): remember its cap, so requests that
      // size skip it from now on, and leave the provider's other models free for this one
      if (e.kind === 'rate_limit' && e.tokenLimit) {
        await saveTokenCap(deps.db, userId, m.provider, m.modelId, e.tokenLimit).catch((err) => console.error('limit save failed', err));
        continue;
      }
      // this model's quota for the day is gone (Gemini: "…PerDay…"): leave it out until it resets instead
      // of asking (and being refused) every minute — the provider's other models have their own quotas
      if (e.kind === 'rate_limit' && e.daily) {
        const resetAt = nextMidnight(m.provider === 'gemini' ? 'America/Los_Angeles' : 'UTC', new Date(now()));
        await markExhausted(deps.db, userId, m.provider, m.modelId, resetAt).catch((err) => console.error('limit save failed', err));
        resetTimes.push(resetAt.getTime());
        continue;
      }
      // the network's doing (blocked page, no connection) never marks the key invalid
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

    // a stream that opens with only an error (an overloaded upstream): nothing has reached the client
    // yet, so the next model can still take the request
    let streamBody: ReadableStream<Uint8Array> | null = r.response.body;
    if (stream && streamBody && /event-stream/i.test(r.response.headers.get('content-type') ?? '')) {
      const peek = await peekFirstEvent(streamBody);
      streamBody = peek.stream;
      if (peek.error) {
        void peek.stream.cancel().catch(() => {});
        const limited = /rate.?limit|quota|too many requests|\b429\b/i.test(peek.error);
        skipped.push(`${m.provider}/${m.modelId} (${limited ? 'rate limit' : 'server'})`);
        otherFailures++;
        console.warn(`[router] ${m.provider}/${m.modelId} opened a stream with an error: ${peek.error}`);
        await recordUsage(deps.db, { ...usageBase, promptTokens: 0, completionTokens: 0, latencyMs: now() - started, status: limited ? 'rate_limited' : 'error' });
        const ttl = limited ? 60_000 : 30_000;
        await deps.kv.set(cooldownKey(userId, m.provider), String(now() + ttl), ttl);
        resetTimes.push(now() + ttl);
        cooling.add(m.provider);
        continue;
      }
    }

    await touchKey(deps.db, userId, m.provider);
    await noteReachable(deps.kv, userId, m.provider);
    if (pinAt) await deps.kv.set(pinAt, `${m.provider}/${m.modelId}`, PIN_MS);
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
      // clients warn the user: these couldn't be reached from their network (restricted Wi-Fi?)
      ...(unreachable.size ? { 'x-freetoken-unreachable': [...unreachable].join(',') } : {}),
    };

    if (stream && streamBody) {
      const upstream = m.provider === 'gemini' ? standardizeGeminiStream(streamBody) : streamBody;
      const tapped = tapSseUsage(upstream, ({ usage, completionChars, failed, error, signatures }) => {
        if (failed) console.warn(`[router] ${m.provider}/${m.modelId} broke off mid-stream: ${error ?? 'connection lost'}`);
        if (signatures.size) saveSignatures(deps.kv, userId, signatures).catch(() => {});
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
    if (m.provider === 'gemini') standardizeGeminiAnswer(json);
    const sigs = signaturesIn(json.choices?.[0]?.message, new Map());
    if (sigs.size) await saveSignatures(deps.kv, userId, sigs);
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

  // nothing answered and it was the network every time: say so, instead of "out of quota"
  if (unreachable.size && !otherFailures) {
    return fail(503, 'network_unreachable', unreachableHint([...unreachable]));
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
