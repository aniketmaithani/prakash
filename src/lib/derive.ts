import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Article, Category } from "./types";
import { CATEGORIES, CATEGORY_BY_ID, COUNTRY_BY_CODE, TIME_RANGES } from "./meta";
import type { ArcDatum, BeaconDatum, LabelDatum } from "../globe/GlobeEngine";

export type FeedMode = "global" | "country" | "search";

function dominant(list: Article[]): Category {
  const counts = new Map<Category, number>();
  for (const a of list) counts.set(a.category, (counts.get(a.category) || 0) + (a.category === "world" ? 0.6 : 1));
  let best: Category = "world", n = -1;
  for (const [c, v] of counts) if (v > n) { n = v; best = c; }
  return best;
}

/** Re-renders on an interval so relative times ("4 min ago") stay honest. */
export function useNow(interval = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

/** Everything the globe and panels need, derived once per data/filter change. */
export function useDerived() {
  const articles = useStore((s) => s.articles);
  const search = useStore((s) => s.search);
  const category = useStore((s) => s.category);
  const timeRange = useStore((s) => s.timeRange);
  const selected = useStore((s) => s.selectedCountry);
  const countryFeeds = useStore((s) => s.countryFeeds);
  const statusVersion = useStore((s) => s.status?.updatedAt);

  return useMemo(() => {
    const now = Date.now();
    const maxAge = TIME_RANGES.find((t) => t.id === timeRange)!.ms;
    const inTime = (a: Article) => now - a.publishedAt <= maxAge;
    const inCat = (a: Article) => category === "all" || a.category === category;

    const mode: FeedMode = search ? "search" : selected ? "country" : "global";
    // The globe shows search results while searching, otherwise the world feed.
    const mapSource = (search ? search.articles : articles).filter(inTime);
    const mapArticles = mapSource.filter(inCat);

    const categoryCounts: Record<string, number> = { all: mapSource.length };
    for (const c of CATEGORIES) categoryCounts[c.id] = 0;
    for (const a of mapSource) categoryCounts[a.category]++;

    const byCountry = new Map<string, Article[]>();
    for (const a of mapArticles) {
      const list = byCountry.get(a.country) || [];
      list.push(a);
      byCountry.set(a.country, list);
    }

    // Attention: how often each country is named in other countries' headlines.
    const mentioned = new Map<string, number>();
    for (const a of mapArticles) for (const m of a.mentions) if (m !== a.country) mentioned.set(m, (mentioned.get(m) || 0) + 1);

    const beacons: BeaconDatum[] = [];
    const labels: LabelDatum[] = [];
    const heat: Record<string, number> = {};
    let maxCount = 1;
    for (const list of byCountry.values()) maxCount = Math.max(maxCount, list.length);
    for (const [code, list] of byCountry) {
      const c = COUNTRY_BY_CODE.get(code);
      if (!c) continue;
      const cat = category === "all" ? dominant(list) : category;
      beacons.push({
        code, lat: c.lat, lng: c.lng, count: list.length, weight: list.length + (mentioned.get(code) || 0), color: CATEGORY_BY_ID[cat].color,
        breaking: list.some((a) => now - a.publishedAt < 45 * 60e3),
      });
      labels.push({ code, lat: c.lat, lng: c.lng, name: c.name, count: list.length, priority: list.length + (mentioned.get(code) || 0) + (code === selected ? 1e4 : 0) + c.size * 0.2 });
      heat[code] = list.length + (mentioned.get(code) || 0);
    }
    // Heat is relative attention, scaled to the 90th percentile so a single giant doesn't wash out the map.
    const hv = Object.values(heat).sort((a, b) => a - b);
    const p90 = Math.max(1, hv[Math.floor(hv.length * 0.9)] || 1);
    const p10 = hv[Math.floor(hv.length * 0.1)] || 0;
    for (const k of Object.keys(heat)) heat[k] = Math.min(1, Math.max(0, (heat[k] - p10) / Math.max(1, p90 - p10)));
    void maxCount;
    if (selected && !byCountry.has(selected)) {
      const c = COUNTRY_BY_CODE.get(selected);
      if (c) labels.push({ code: c.code, lat: c.lat, lng: c.lng, name: c.name, count: 0, priority: 1e4 });
    }

    // Connections: headlines filed in one country that name another.
    const pairs = new Map<string, { from: string; to: string; list: Article[] }>();
    for (const a of mapArticles) {
      for (const m of a.mentions) {
        if (!COUNTRY_BY_CODE.has(m) || m === a.country) continue;
        const key = a.country < m ? `${a.country}|${m}` : `${m}|${a.country}`;
        const p = pairs.get(key) || { from: a.country, to: m, list: [] };
        p.list.push(a);
        pairs.set(key, p);
      }
    }
    let pairList = [...pairs.values()];
    if (selected) pairList = pairList.filter((p) => p.from === selected || p.to === selected);
    pairList.sort((a, b) => b.list.length - a.list.length);
    const arcs: ArcDatum[] = pairList.slice(0, selected ? 30 : 42).map((p) => {
      const f = COUNTRY_BY_CODE.get(p.from)!, t = COUNTRY_BY_CODE.get(p.to)!;
      return { from: { lat: f.lat, lng: f.lng }, to: { lat: t.lat, lng: t.lng }, color: CATEGORY_BY_ID[category === "all" ? dominant(p.list) : category].color, weight: p.list.length };
    });

    // Panel feed.
    let feed: Article[];
    let feedLoading = false;
    let feedError: string | undefined;
    if (mode === "search") {
      feed = search!.articles.filter(inTime).filter(inCat);
      feedLoading = search!.loading;
      feedError = search!.error;
    } else if (mode === "country") {
      const deep = countryFeeds[selected!];
      const base = deep?.articles.length ? deep.articles : articles.filter((a) => a.country === selected);
      feed = base.filter(inTime).filter(inCat);
      feedLoading = !!deep?.loading && !deep.articles.length;
      feedError = deep?.error;
    } else {
      feed = mapArticles;
    }

    const connections = selected
      ? pairList.slice(0, 6).map((p) => ({ code: p.from === selected ? p.to : p.from, count: p.list.length }))
      : [];

    // Ranked by attention: own coverage plus how often other countries' headlines name it.
    const countryRank = [...byCountry.entries()].map(([code, list]) => ({ code, count: list.length + (mentioned.get(code) || 0) })).sort((a, b) => b.count - a.count);

    return { mode, beacons, labels, heat, arcs, feed, feedLoading, feedError, categoryCounts, connections, countryRank, mapArticles, topPairs: pairList.slice(0, 8) };
    // statusVersion forces a recompute so "breaking" and time windows stay current between data pulls.
  }, [articles, search, category, timeRange, selected, countryFeeds, statusVersion]);
}
