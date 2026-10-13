import { models } from '@/db/schema';
import { loadCredentials, markInvalid, touchKey } from '@/keys/service';
import { callChat } from '@/providers/client';
import { getProvider } from '@/providers/registry';
import type { Deps } from '@/server/deps';
import { estimateTokens, recordUsage, usageToday } from '@/usage/ledger';
import { tapSseUsage } from '@/usage/tap';
import { parseRateHeaders, saveLimits } from '@/usage/limits';
import { isAuto, parseModelRef, selectCandidates, type CatalogModel } from './select';

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
  if (creds.size === 0) {
    return fail(400, 'no_providers', 'You have no connected providers. Add an API key at /connect.');
  }

  const catalog = (await deps.db.select().from(models)) as CatalogModel[];
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

  const promptEstimate = estimateTokens(body.messages);
  const selectInput = {
    requested,
    models: catalog,
    connected: [...creds].map(([provider, c]) => ({ provider, excludedFromAuto: c.excludedFromAuto })),
    cooling,
    usageToday: await usageToday(deps.db, userId, new Date(now())),
    promptTokens: promptEstimate,
    needsTools: Array.isArray(body.tools) && body.tools.length > 0,
  };
  const candidates = selectCandidates(selectInput);
  // Empty even with quota ignored: no connected model can serve this request at all.
  if (candidates.length === 0 && selectCandidates({ ...selectInput, cooling: new Set(), usageToday: new Map() }).length === 0) {
    return fail(400, 'no_capable_model',
      'None of your connected models can handle this request (it may need tool support or a longer context window, ' +
      'or every provider is excluded from auto-routing). Connect more providers at /connect.');
  }

  const stream = body.stream === true;

  for (const m of candidates) {
    if (cooling.has(m.provider)) continue; // a model of this provider failed earlier in this loop
    const def = getProvider(m.provider);
    const c = creds.get(m.provider);
    if (!def || !c) continue;

    const started = now();
    const usageBase = { userId, provider: m.provider, modelId: m.modelId, source };
    const r = await callChat(def, c.creds, { ...body, model: m.modelId }, { fetchImpl: deps.fetchImpl });

    if (!r.ok) {
      const e = r.error;
      await recordUsage(deps.db, {
        ...usageBase, promptTokens: 0, completionTokens: 0, latencyMs: now() - started,
        status: e.kind === 'rate_limit' ? 'rate_limited' : 'error',
      });
      if (e.kind === 'bad_request') return fail(e.status, 'upstream_bad_request', e.message);
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
    };

    if (stream && r.response.body) {
      const tapped = tapSseUsage(r.response.body, ({ usage, completionChars, failed }) => {
        recordUsage(deps.db, {
          ...usageBase,
          promptTokens: usage?.promptTokens ?? promptEstimate,
          completionTokens: usage?.completionTokens ?? Math.ceil(completionChars / 4),
          status: failed ? 'error' : 'ok',
          latencyMs: now() - started,
        }).catch((err) => console.error('usage record failed', err));
      });
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
