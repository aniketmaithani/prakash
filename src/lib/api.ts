import { useStore } from "../store";
import type { Article, NewsStatus } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function dedupe(list: Article[]) {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true))).sort((a, b) => b.publishedAt - a.publishedAt);
}

let lastVersion = -1;

// Static builds (GitHub Pages) read JSON baked by scripts/snapshot.mjs instead of the live API.
const STATIC = import.meta.env.VITE_STATIC === "1";
const DATA = `${import.meta.env.BASE_URL}data/`;
const URLS = STATIC
  ? { status: `${DATA}status.json`, news: `${DATA}news.json` }
  : { status: "/api/status", news: "/api/news" };
// Countries the snapshot fetched in depth; the rest are filled from the global feed.
let deepCountries = new Set<string>();
// A shared #country= link can ask for a country before the first news pull lands.
let markLoaded: () => void;
const firstPull = new Promise<void>((r) => (markLoaded = r));
// Pages caches for ten minutes, so add a coarse cache-buster to see a new deploy sooner.
const bust = (url: string) => (STATIC ? `${url}?t=${Math.floor(Date.now() / 120000)}` : url);

async function pullNews() {
  const data = await getJson<NewsStatus & { articles: Article[]; deep?: string[] }>(bust(URLS.news));
  const { articles: articlesRaw, deep, ...status } = data;
  if (deep) deepCountries = new Set(deep);
  const s = useStore.getState();
  const articles = dedupe(articlesRaw);
  const prevIds = new Set(s.articles.map((a) => a.id));
  const fresh = s.firstLoad ? 0 : articles.filter((a) => !prevIds.has(a.id) && Date.now() - a.publishedAt < 3 * 3600e3).length;
  s.set({ articles, status, firstLoad: articles.length === 0, apiError: null });
  markLoaded();
  // Only announce new stories after the initial warm-up, once the user has something to compare against.
  if (fresh > 0 && !status.refreshing && !s.status?.refreshing) {
    s.set({ newSinceSeen: s.newSinceSeen + fresh });
    s.toast(`${fresh} new ${fresh === 1 ? "story" : "stories"} just landed`);
  }
}

/** Polls a tiny status endpoint and only downloads the full payload when the server has new data. */
export function startPolling() {
  let timer: number;
  const loop = async () => {
    let delay = 30000;
    try {
      const status = await getJson<NewsStatus>(bust(URLS.status));
      const s = useStore.getState();
      // While the first sweep is running, refresh in larger steps so beacons fill in smoothly without hammering.
      const step = status.refreshing ? 12 : 1;
      if (lastVersion < 0 || status.version - lastVersion >= step || (!status.refreshing && status.version !== lastVersion)) {
        lastVersion = status.version;
        await pullNews();
      } else {
        s.set({ status, apiError: null });
      }
      delay = status.refreshing ? 2500 : STATIC ? 120000 : 30000;
    } catch (e) {
      useStore.getState().set({ apiError: "Can’t reach the news service. Retrying…" });
      delay = 5000;
    }
    timer = window.setTimeout(loop, delay);
  };
  loop();
  return () => clearTimeout(timer);
}

export async function refreshNow() {
  lastVersion = -1;
  await pullNews();
}

export async function loadCountry(code: string, force = false) {
  const s = useStore.getState();
  const existing = s.countryFeeds[code];
  if (existing && (existing.loading || (!force && existing.articles.length))) return;
  s.set({ countryFeeds: { ...s.countryFeeds, [code]: { articles: existing?.articles || [], loading: true } } });
  try {
    const data = STATIC ? await staticCountry(code) : await getJson<{ articles: Article[] }>(`/api/country?code=${code}`);
    const cur = useStore.getState();
    cur.set({ countryFeeds: { ...cur.countryFeeds, [code]: { articles: dedupe(data.articles || []), loading: false } } });
  } catch (e) {
    const cur = useStore.getState();
    cur.set({ countryFeeds: { ...cur.countryFeeds, [code]: { articles: existing?.articles || [], loading: false, error: "Couldn’t load this country’s newsrooms. Try again in a moment." } } });
  }
}

let searchSeq = 0;
export async function runSearch(query: string) {
  const q = query.trim();
  const s = useStore.getState();
  if (!q) {
    s.set({ search: null });
    return;
  }
  const seq = ++searchSeq;
  s.set({ search: { query: q, articles: [], loading: true }, selectedCountry: null, openArticle: null, tab: "stories", sheet: "half" });
  try {
    const data = STATIC ? await staticSearch(q) : await getJson<{ articles: Article[] }>(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    useStore.getState().set({ search: { query: q, articles: dedupe(data.articles || []), loading: false } });
  } catch {
    if (seq !== searchSeq) return;
    useStore.getState().set({ search: { query: q, articles: [], loading: false, error: "Search is unavailable right now. Check your connection and try again." } });
  }
}

// ---- static host fallbacks

async function staticCountry(code: string): Promise<{ articles: Article[] }> {
  await firstPull;
  const all = useStore.getState().articles;
  const local = all.filter((a) => a.country === code || a.mentions.includes(code));
  if (!deepCountries.has(code)) return { articles: local };
  try {
    const data = await getJson<{ articles: Article[] }>(bust(`${DATA}country/${code}.json`));
    return { articles: [...data.articles, ...local] };
  } catch {
    return { articles: local };
  }
}

/** Without a server we can't query Bing, so search what's already loaded. Every word has to match. */
async function staticSearch(q: string): Promise<{ articles: Article[] }> {
  await firstPull;
  // Match at word starts so "ai" doesn't hit "said".
  const words = q.split(/\s+/).filter(Boolean).map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  const s = useStore.getState();
  const pool = [...s.articles, ...Object.values(s.countryFeeds).flatMap((f) => f.articles)];
  const hits = pool.filter((a) => {
    const text = `${a.title} ${a.snippet} ${a.source}`;
    return words.every((w) => w.test(text));
  });
  return { articles: hits.slice(0, 400) };
}
