import type { Article } from "./types";
import { COUNTRIES } from "./meta";

const STOP = new Set(
  ("the a an and or but of for to in on at by with from as is are was were be been it its this that these those after before over under into about amid " +
    "new says said say will would could can may might not no yes up down out more most than how why what when where who which while during against " +
    "his her their our your my he she they we you i us them him one two three first last year years week day days today monday tuesday wednesday thursday " +
    "friday saturday sunday january february march april may june july august september october november december live update updates news report " +
    "breaking watch video photos here just now also back get gets got set sets make makes all any some other per via vs mr ms dr st de la le el " +
    // Words newsrooms capitalise constantly that name nothing in particular.
    "world africa african asia asian europe european america latin middle east west north south central global international national " +
    "republic president minister prime government court police city state states county province region union cup league club team " +
    "million billion percent day night home people man woman women men police chief party bank group council ministry department " +
    "university school hospital company market markets news daily times post business sport sports health science tech technology " +
    "review opinion analysis exclusive explained first final top big best old young next official officials former deputy senior").split(" ")
);

// Country names and demonyms appear in nearly every headline from that country, which says nothing about what is trending.
const GEO = new Set<string>();
for (const c of COUNTRIES) {
  GEO.add(c.name.toLowerCase());
  for (const part of c.name.toLowerCase().split(/\s+/)) if (part.length > 2) GEO.add(part);
  for (const a of c.aliases) GEO.add(a.toLowerCase());
}

export interface Trend {
  term: string;
  count: number;
  countries: number;
}

/** Capitalised phrases (people, places, organisations, events) that recur across independent stories. */
export function trendingTerms(articles: Article[], limit = 14): Trend[] {
  const counts = new Map<string, { n: number; countries: Set<string>; display: string }>();
  for (const a of articles) {
    // Title Case headlines capitalise every word, so capitals there say nothing about names.
    const long = a.title.split(/\s+/).filter((w) => w.length > 3);
    if (long.length >= 4 && long.filter((w) => /^\p{Lu}/u.test(w)).length / long.length > 0.6) continue;
    const words = a.title.replace(/[“”"‘’:;,!?()[\]|—–]/g, " ").split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      for (let len = Math.min(3, run.length); len >= 1; len--) {
        for (let i = 0; i + len <= run.length; i++) {
          const phrase = run.slice(i, i + len).join(" ").replace(/'s$/, "");
          const key = phrase.toLowerCase();
          if (key.length < 3 || STOP.has(key) || GEO.has(key) || seen.has(key)) continue;
          if (len === 1 && /^\d/.test(key)) continue;
          seen.add(key);
          const entry = counts.get(key) || { n: 0, countries: new Set(), display: phrase };
          entry.n++;
          entry.countries.add(a.country);
          counts.set(key, entry);
        }
      }
      run = [];
    };
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "").replace(/'s$|’s$/, "");
      if (GEO.has(clean.toLowerCase()) || GEO.has(`${clean.toLowerCase()}.`)) { flush(); return; }
      const cap = /^\p{Lu}/u.test(clean) || /^[A-Z0-9]{2,}$/.test(clean);
      // Skip the first word: it is capitalised by grammar, not because it is a name.
      if (cap && i > 0 && !STOP.has(clean.toLowerCase())) run.push(clean);
      else flush();
    });
    flush();
  }
  const list = [...counts.entries()]
    .filter(([, v]) => v.n >= 3)
    .map(([, v]) => ({ term: v.display, count: v.n, countries: v.countries.size, score: v.n * (1 + Math.log2(v.countries.size)) * (v.display.includes(" ") ? 1.4 : 1) }))
    .sort((a, b) => b.score - a.score);
  // A single word that mostly appears inside a phrase ("Sea" in "Black Sea") is that phrase, not its own trend.
  const phrases = list.filter((t) => t.term.includes(" "));
  const filtered = list.filter((t) => t.term.includes(" ") || !phrases.some((p) => p.count >= t.count * 0.5 && p.term.toLowerCase().split(" ").includes(t.term.toLowerCase())));
  // Drop single words already covered by a stronger phrase ("Trump" vs "Donald Trump").
  const out: Trend[] = [];
  for (const t of filtered) {
    const k = t.term.toLowerCase();
    if (out.some((o) => o.term.toLowerCase().includes(k) || k.includes(o.term.toLowerCase()))) continue;
    out.push({ term: t.term, count: t.count, countries: t.countries });
    if (out.length >= limit) break;
  }
  return out;
}
