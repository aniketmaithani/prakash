// Bakes the current headlines into plain JSON files so the app can run on a static host
// such as GitHub Pages, where there is no server to call Bing for us.
//
//   node scripts/snapshot.mjs [outDir]      (outDir defaults to dist/data)
//
// Writes status.json (tiny, polled by the client), news.json (every country) and
// country/XX.json with fuller coverage for the countries getting the most attention.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { refreshOnce, getAllNews, getCountryNews } from "../server/news.mjs";

const OUT = resolve(process.argv[2] || "dist/data");
const DEEP_COUNT = Number(process.env.DEEP_COUNTRIES ?? 30);
// Matches the cron in .github/workflows/pages.yml. Only used to tell visitors when to expect fresh data.
const INTERVAL_MS = 30 * 60 * 1000;

const started = Date.now();
const sweep = await refreshOnce();
console.log(`swept ${sweep.countries} countries, ${sweep.failures} failed requests`);

// Rank countries the same way the globe does: own stories plus mentions elsewhere.
const attention = new Map();
for (const a of getAllNews().articles) {
  attention.set(a.country, (attention.get(a.country) || 0) + 1);
  for (const m of a.mentions) attention.set(m, (attention.get(m) || 0) + 1);
}
const top = [...attention.entries()].sort((a, b) => b[1] - a[1]).slice(0, DEEP_COUNT).map(([code]) => code);

mkdirSync(join(OUT, "country"), { recursive: true });
const deep = [];
for (const code of top) {
  const data = await getCountryNews(code);
  if (!data.articles?.length) continue;
  writeFileSync(join(OUT, "country", `${code}.json`), JSON.stringify({ code, articles: data.articles }));
  deep.push(code);
}
console.log(`deep coverage for ${deep.length} countries`);

// getCountryNews folds its results back into the global map, so read the news after it.
const news = getAllNews();
if (!news.articles.length) {
  console.error("No headlines at all. Not writing an empty site.");
  process.exit(1);
}
const updatedAt = Date.now();
const status = {
  version: updatedAt,
  refreshing: false,
  progress: { done: news.countries, total: news.countries },
  updatedAt,
  countries: news.countries,
  nextRefreshAt: updatedAt + INTERVAL_MS,
  deep,
};
writeFileSync(join(OUT, "status.json"), JSON.stringify(status));
writeFileSync(join(OUT, "news.json"), JSON.stringify({ ...status, articles: news.articles }));
console.log(`${news.articles.length} stories written to ${OUT} in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(0);
