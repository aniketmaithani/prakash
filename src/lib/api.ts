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

async function pullNews() {
  const data = await getJson<NewsStatus & { articles: Article[] }>("/api/news");
  const { articles: articlesRaw, ...status } = data;
  const s = useStore.getState();
  const articles = dedupe(articlesRaw);
  const prevIds = new Set(s.articles.map((a) => a.id));
  const fresh = s.firstLoad ? 0 : articles.filter((a) => !prevIds.has(a.id) && Date.now() - a.publishedAt < 3 * 3600e3).length;
  s.set({ articles, status, firstLoad: articles.length === 0, apiError: null });
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
      const status = await getJson<NewsStatus>("/api/status");
      const s = useStore.getState();
      // While the first sweep is running, refresh in larger steps so beacons fill in smoothly without hammering.
      const step = status.refreshing ? 12 : 1;
      if (lastVersion < 0 || status.version - lastVersion >= step || (!status.refreshing && status.version !== lastVersion)) {
        lastVersion = status.version;
        await pullNews();
      } else {
        s.set({ status, apiError: null });
      }
      delay = status.refreshing ? 2500 : 30000;
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
    const data = await getJson<{ articles: Article[] }>(`/api/country?code=${code}`);
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
    const data = await getJson<{ articles: Article[] }>(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;
    useStore.getState().set({ search: { query: q, articles: dedupe(data.articles || []), loading: false } });
  } catch {
    if (seq !== searchSeq) return;
    useStore.getState().set({ search: { query: q, articles: [], loading: false, error: "Search is unavailable right now. Check your connection and try again." } });
  }
}
