// The agent's window to the web, with no keys: search (DuckDuckGo's lite page) and a reader for pages
// and data APIs (Jina Reader turns web pages into clean text; JSON / plain text / APIs are fetched
// directly). What comes back is data from the web, never instructions.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 V-Run/1.0";
const MAX_CHARS = 24_000;
type Fetch = typeof fetch;

const decode = (s: string) => s
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ").trim();

export interface Hit { title: string; url: string; snippet: string }

/** FreeToken's search (Tavily, when the user connected a free key there); set by the main process. */
let freeTokenSearch: ((query: string) => Promise<Hit[] | null>) | null = null;
export const setFreeTokenSearch = (fn: typeof freeTokenSearch) => { freeTokenSearch = fn; };

/**
 * Web search results (title, url, snippet). Free search engines block automated requests now and
 * then, so several are tried: FreeToken's Tavily search (reliable, if connected), DuckDuckGo, Wikipedia.
 */
export async function webSearch(query: string, max = 8, f: Fetch = fetch): Promise<Hit[]> {
  const problems: string[] = [];
  if (freeTokenSearch) {
    try { const hits = await freeTokenSearch(query); if (hits?.length) return hits.slice(0, max); } catch (e) { problems.push((e as Error).message); }
  }
  try { const hits = await duckDuckGo(query, max, f); if (hits.length) return hits; } catch (e) { problems.push((e as Error).message); }
  try { const hits = await wikipedia(query, max, f); if (hits.length) return hits; } catch (e) { problems.push((e as Error).message); }
  if (problems.length) throw new Error(`Search is unavailable right now (${problems.join("; ")}). Read known pages or APIs with fetch_url instead${freeTokenSearch ? "" : ", or connect a free Tavily key in FreeToken for reliable search"}.`);
  return [];
}

async function wikipedia(query: string, max: number, f: Fetch): Promise<Hit[]> {
  const res = await f(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${max}&srsearch=${encodeURIComponent(query)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const j = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  return (j.query?.search ?? []).map((r) => ({ title: `${r.title} — Wikipedia`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, snippet: decode(r.snippet) }));
}

async function duckDuckGo(query: string, max: number, f: Fetch): Promise<Hit[]> {
  const res = await f("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", "accept-language": "en" },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The search service answered ${res.status}.`);
  const html = await res.text();
  const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
  const hits: Hit[] = [];
  links.forEach((m, i) => {
    let url = m[1].replace(/&amp;/g, "&");
    const redirect = url.match(/[?&]uddg=([^&]+)/); // DuckDuckGo wraps some links
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (/^https?:\/\//.test(url) && !/duckduckgo\.com\/y\.js/.test(url)) hits.push({ title: decode(m[2]) || url, url, snippet: snippets[i] ?? "" });
  });
  if (!hits.length && /anomaly|captcha|bot/i.test(html)) throw new Error("The search service asked for a captcha — try again in a minute, or read a known page with fetch_url.");
  return hits.slice(0, max);
}

const isPage = (type: string) => /text\/html|application\/xhtml/i.test(type);

/** A page as readable text (or an API's raw response), from `start` (to read long pages in parts). */
export async function fetchUrl(target: string, start = 0, f: Fetch = fetch): Promise<{ url: string; title: string; text: string; total: number; via: string }> {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(target.trim()) ? target.trim() : `https://${target.trim()}`;
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs can be read.");
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/.test(u.hostname);
  let title = "", text = "", via = "direct";
  // first a direct request: APIs (JSON, XML, text) and local servers are read as they are
  const res = await f(url, { headers: { "user-agent": UA, accept: "text/html,application/json,text/plain,*/*", "accept-language": "en" }, signal: AbortSignal.timeout(25_000) }).catch((e) => e as Error);
  const type = res instanceof Response ? res.headers.get("content-type") ?? "" : "";
  if (res instanceof Response && res.ok && !isPage(type)) {
    if (/image|video|audio|octet-stream|pdf|zip/i.test(type)) throw new Error(`That's a ${type} file, not text. Download it with a terminal command if you need it.`);
    text = await res.text();
  } else if (!local) {
    // web pages: Jina Reader renders them (scripts too) and returns clean markdown
    const jr = await f(`https://r.jina.ai/${url}`, { headers: { accept: "application/json", "x-return-format": "markdown" }, signal: AbortSignal.timeout(40_000) }).catch(() => null);
    if (jr?.ok) {
      const j = (await jr.json().catch(() => null)) as { data?: { title?: string; content?: string } } | null;
      title = j?.data?.title ?? ""; text = j?.data?.content ?? ""; via = "reader";
    }
  }
  if (!text && res instanceof Response && res.ok && isPage(type)) {
    // fallback: the page's own HTML, stripped down to its text
    const html = await res.text();
    title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  }
  if (!text) throw new Error(res instanceof Response ? `The page answered ${res.status} and couldn't be read.` : `Couldn't reach ${u.hostname}: ${(res as Error).message}`);
  return { url, title, text: text.slice(start, start + MAX_CHARS), total: text.length, via };
}
