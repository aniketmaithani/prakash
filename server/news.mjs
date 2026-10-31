// News aggregation: Bing News RSS per country, keyword categorisation, cross-country mention
// detection, stale-while-revalidate caching with a disk snapshot so restarts are instant.
import { XMLParser } from "fast-xml-parser";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const COUNTRIES = JSON.parse(readFileSync(new URL("../src/data/countries.json", import.meta.url)));
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const NEWS_COUNTRIES = COUNTRIES.filter((c) => c.news);

const CACHE_DIR = new URL("../.cache/", import.meta.url);
const CACHE_FILE = new URL("news.json", CACHE_DIR);
const FRESH_MS = 12 * 60 * 1000;
const COUNTRY_DEEP_MS = 8 * 60 * 1000;
const SEARCH_MS = 5 * 60 * 1000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;
const MAX_PER_COUNTRY = 14;
const MAX_AGE_MS = 4 * 24 * 3600 * 1000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

// Bing markets with an English edition; other countries are searched through en-US.
const MARKETS = { US: "en-US", GB: "en-GB", IN: "en-IN", AU: "en-AU", CA: "en-CA", NZ: "en-NZ", ZA: "en-ZA", PH: "en-PH", MY: "en-MY", ID: "en-ID", IE: "en-IE", SG: "en-SG" };

const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: true });

// ---------------------------------------------------------------- categorisation
const LEXICON = {
  conflict: /\b(war|wars|missiles?|troops|military|airstrikes?|air strikes?|ceasefire|cease-fire|militants?|drones?|bombings?|shelling|invasion|hostages?|army|rebels?|clashes|insurgents?|offensive|frontline|artillery|killed in|gunmen|armed|warplanes?|navy|soldiers?|terror(ist|ism)?|militia)\b/i,
  politics: /\b(elections?|electoral|parliament|parliamentary|minister|ministers|president|presidential|vote|voters|voting|senate|congress|lawmakers?|government|opposition|prime minister|party|coalition|sanctions|diplomat(s|ic)?|summit|referendum|campaign|policy|cabinet|supreme court|legislation|bill|governor|mayor|protest(s|ers)?|treaty|ambassador|un security council|nato)\b/i,
  business: /\b(markets?|stocks?|shares|economy|economic|inflation|banks?|banking|trade|tariffs?|gdp|investors?|investment|revenue|profits?|earnings|ipo|currency|rupee|dollar|euro|yen|oil prices?|crude|prices|exports?|imports?|interest rates?|central bank|fed|startup funding|merger|acquisition|deal|billion|layoffs|jobs report|unemployment|budget|tax|debt|bonds?|retail|airline|manufacturing)\b/i,
  technology: /\b(ai|artificial intelligence|tech|technology|software|apple|google|microsoft|meta|amazon|nvidia|openai|chips?|semiconductors?|startups?|cyber(attack|security)?|hack(ers|ed)?|smartphones?|iphone|android|apps?|robots?|robotics|internet|5g|data cent(er|re)s?|crypto|bitcoin|blockchain|electric vehicles?|evs?|tesla|spacex|algorithm|chatbot|quantum)\b/i,
  science: /\b(scientists?|study finds|study|research(ers)?|nasa|isro|esa|space|planet|asteroid|comet|moon|mars|species|fossils?|physics|telescope|astronom(y|ers)|discovery|discovered|genome|dna|archaeolog(y|ists)|dinosaur|rocket|launch(es|ed)? into orbit|satellite|evolution|biodiversity)\b/i,
  health: /\b(health|hospitals?|disease|virus|outbreak|vaccines?|vaccination|cancer|patients?|medical|medicine|doctors?|nurses|cholera|dengue|malaria|mpox|covid|flu|influenza|measles|mental health|obesity|diabetes|drug|pharma|surgery|epidemic|pandemic|healthcare|nutrition)\b/i,
  sports: /\b(football|soccer|cricket|match|cup|league|tournament|olympics?|olympic|coach|goals?|nba|nfl|mlb|nhl|tennis|f1|formula 1|grand prix|championship|rugby|players?|striker|world cup|ipl|t20|odi|test series|fifa|uefa|premier league|la liga|serie a|bundesliga|wimbledon|marathon|athletics|boxing|ufc|golf|medal|innings|wicket|squad|transfer|fixture|stadium|semi-?final|quarter-?final|final)\b/i,
  entertainment: /\b(film|films|movie|movies|music|singer|actor|actress|celebrity|celebrities|album|netflix|hollywood|bollywood|box office|concert|tv series|tv show|oscars?|grammys?|emmys?|k-pop|kpop|rapper|band|trailer|premiere|streaming|director|festival|royal|fashion|showbiz|star wars|disney)\b/i,
  climate: /\b(climate|floods?|flooding|wildfires?|bushfires?|heatwaves?|heat wave|drought|emissions|cyclones?|hurricanes?|typhoons?|earthquakes?|quake|tsunami|storms?|cop\d\d|carbon|renewables?|solar power|wind power|weather|monsoon|landslides?|volcano|eruption|glaciers?|pollution|deforestation|el ni[nñ]o|rainfall|tornado(es)?)\b/i,
};
// Weighting resolves overlap: a "World Cup final" is sport even though "final" and "cup" are generic.
const WEIGHTS = { conflict: 1.3, sports: 1.2, health: 1.15, climate: 1.15, technology: 1.1, science: 1.05, entertainment: 1.0, business: 0.95, politics: 0.9 };

function classify(title, snippet, hint) {
  let best = "world", bestScore = 0;
  for (const [cat, re] of Object.entries(LEXICON)) {
    const g = new RegExp(re.source, "gi");
    const t = new Set((title.match(g) || []).map((h) => h.toLowerCase()));
    const s = new Set((snippet.match(g) || []).map((h) => h.toLowerCase()));
    let score = (t.size * 2 + s.size) * WEIGHTS[cat];
    if (cat === hint && score > 0) score += 1.5;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  if (bestScore < 1.5 && hint) return hint;
  return best;
}

// ---------------------------------------------------------------- mentions
const AMBIGUOUS_NAMES = new Set(["GE", "JO", "TD", "NE", "GN", "TR", "CG", "DM"]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MENTION_RES = COUNTRIES.map((c) => {
  const terms = [...new Set([...(AMBIGUOUS_NAMES.has(c.code) ? [] : [c.name]), ...c.aliases])];
  if (!terms.length) return null;
  return [c.code, new RegExp(`(?<![\\w])(${terms.map(esc).join("|")})(?![\\w])`)];
}).filter(Boolean);

function findMentions(text, own) {
  const out = [];
  for (const [code, re] of MENTION_RES) {
    if (code !== own && re.test(text)) out.push(code);
    if (out.length >= 4) break;
  }
  return out;
}

// ---------------------------------------------------------------- fetching
async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": UA, accept: "application/rss+xml,text/xml;q=0.9,*/*;q=0.8" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function bingUrl(q, mkt) {
  return `https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(q)}&qft=${encodeURIComponent('sortbydate="1"')}&mkt=${mkt}&setlang=en`;
}

function unwrap(link) {
  if (!link.includes("apiclick.aspx")) return link;
  try { return new URL(link).searchParams.get("url") || link; } catch { return link; }
}

const text = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v)).trim();
const strip = (s) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function parseBing(xml, { country, hint }) {
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  const out = [];
  for (const it of items) {
    const url = unwrap(text(it.link));
    let title = strip(text(it.title));
    if (!url || !title) continue;
    const snippet = strip(text(it.description)).slice(0, 320);
    const t = Date.parse(text(it.pubDate));
    const publishedAt = Number.isNaN(t) ? Date.now() : t;
    if (Date.now() - publishedAt > MAX_AGE_MS) continue;
    let image = text(it["News:Image"]);
    if (image) image = image.replace(/^http:/, "https:") + "&w=480&h=270&c=7&rs=1";
    const host = hostOf(url);
    const source = text(it["News:Source"]) || host;
    out.push({
      id: createHash("sha1").update(url).digest("base64url").slice(0, 14),
      title, snippet, url, source, host, publishedAt, image: image || undefined,
      country, category: classify(title, snippet, hint), mentions: findMentions(title, country),
    });
  }
  return out;
}

function dedupe(list) {
  const seenUrl = new Set(), seenTitle = new Set(), out = [];
  for (const a of list) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 70);
    if (seenUrl.has(a.url) || seenTitle.has(key)) continue;
    seenUrl.add(a.url); seenTitle.add(key); out.push(a);
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// ---------------------------------------------------------------- state
const state = {
  byCountry: new Map(), // code -> { articles, fetchedAt }
  version: 0,
  refreshing: false,
  progress: { done: 0, total: NEWS_COUNTRIES.length },
  lastFullRefresh: 0,
  failures: 0,
};
const deepCache = new Map();
const searchCache = new Map();
let snapshotTimer = null;

function loadSnapshot() {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const snap = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    for (const [code, v] of Object.entries(snap.byCountry || {})) state.byCountry.set(code, v);
    state.lastFullRefresh = snap.lastFullRefresh || 0;
    state.version = 1;
  } catch { /* corrupt snapshot: start fresh */ }
}

function saveSnapshotSoon() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify({ lastFullRefresh: state.lastFullRefresh, byCountry: Object.fromEntries(state.byCountry) }));
    } catch { /* read-only FS: memory cache still works */ }
  }, 1500);
}

async function fetchCountry(c) {
  const mkt = MARKETS[c.code] || "en-US";
  const xml = await fetchText(bingUrl(c.query, mkt));
  return dedupe(parseBing(xml, { country: c.code })).slice(0, MAX_PER_COUNTRY);
}

async function refreshAll() {
  if (state.refreshing) return;
  state.refreshing = true;
  // Countries with the oldest data go first so a warm restart fills gaps before polishing.
  const order = [...NEWS_COUNTRIES].sort((a, b) => (state.byCountry.get(a.code)?.fetchedAt || 0) - (state.byCountry.get(b.code)?.fetchedAt || 0));
  state.progress = { done: 0, total: order.length };
  state.failures = 0;
  await pool(order, CONCURRENCY, async (c) => {
    try {
      const articles = await fetchCountry(c);
      if (articles.length) {
        state.byCountry.set(c.code, { articles, fetchedAt: Date.now() });
        state.version++;
      }
    } catch {
      state.failures++;
    }
    state.progress.done++;
    if (state.progress.done % 15 === 0) saveSnapshotSoon();
  });
  state.lastFullRefresh = Date.now();
  state.refreshing = false;
  saveSnapshotSoon();
}

export function startNewsEngine() {
  loadSnapshot();
  const tick = () => { if (Date.now() - state.lastFullRefresh > FRESH_MS) refreshAll(); };
  tick();
  setInterval(tick, 60 * 1000).unref?.();
}

// ---------------------------------------------------------------- API
export function getStatus() {
  return {
    version: state.version,
    refreshing: state.refreshing,
    progress: state.progress,
    updatedAt: state.lastFullRefresh || null,
    countries: state.byCountry.size,
    nextRefreshAt: state.lastFullRefresh ? state.lastFullRefresh + FRESH_MS : null,
  };
}

export function getAllNews() {
  const articles = [];
  for (const { articles: list } of state.byCountry.values()) articles.push(...list);
  return { ...getStatus(), articles };
}

const DEEP_TOPICS = [
  ["", null], ["business economy", "business"], ["technology", "technology"], ["sports", "sports"],
  ["health", "health"], ["film music", "entertainment"], ["science", "science"], ["politics", "politics"], ["climate weather", "climate"],
];

export async function getCountryNews(code) {
  const c = BY_CODE.get(code);
  if (!c) return { error: "Unknown country", status: 400 };
  const hit = deepCache.get(code);
  if (hit && Date.now() - hit.at < COUNTRY_DEEP_MS) return hit.data;
  const mkt = MARKETS[c.code] || "en-US";
  const all = [];
  await pool(DEEP_TOPICS, 4, async ([suffix, hint]) => {
    try {
      const xml = await fetchText(bingUrl(suffix ? `${c.query} ${suffix}` : c.query, mkt));
      all.push(...parseBing(xml, { country: c.code, hint }));
    } catch { /* one topic failing still leaves the rest */ }
  });
  const articles = dedupe(all).slice(0, 90);
  const data = { code, articles, fetchedAt: Date.now() };
  if (articles.length) {
    deepCache.set(code, { at: Date.now(), data });
    // Fold the freshest into the global map so the beacon reflects what the reader just saw.
    state.byCountry.set(code, { articles: articles.slice(0, MAX_PER_COUNTRY), fetchedAt: Date.now() });
    state.version++;
  }
  return data;
}

// A publisher's country-code domain (bbc.co.uk, thehindu.co.in, abc.net.au) is a good hint for where a story is set.
function countryFromHost(host) {
  const tld = (host.split(".").pop() || "").toUpperCase();
  const code = tld === "UK" ? "GB" : tld;
  return code.length === 2 && BY_CODE.has(code) && !["CO", "IO", "TV", "ME", "AI", "LY", "FM"].includes(code) ? code : null;
}

export async function searchNews(q) {
  const query = q.trim().slice(0, 120);
  if (!query) return { query, articles: [] };
  const key = query.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_MS) return hit.data;
  const markets = [["en-US", "US"], ["en-GB", "GB"], ["en-IN", "IN"], ["en-AU", "AU"], ["en-CA", "CA"], ["en-ZA", "ZA"]];
  const all = [];
  await Promise.all(markets.map(async ([mkt, code]) => {
    try {
      const xml = await fetchText(bingUrl(query, mkt));
      for (const a of parseBing(xml, { country: code })) {
        // Place each result where it is about, not where the search market is.
        const about = findMentions(`${a.title}. ${a.snippet}`, "__")[0] || countryFromHost(a.host) || (/\.(com|org|net|gov|edu)$/.test(a.host) && code !== "IN" ? "US" : null);
        if (about) { a.mentions = a.mentions.filter((m) => m !== about); a.country = about; }
        all.push(a);
      }
    } catch { /* partial results are fine */ }
  }));
  const data = { query, articles: dedupe(all).slice(0, 80) };
  searchCache.set(key, { at: Date.now(), data });
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  return data;
}
