import type { Category, Country, TimeRange } from "./types";
import countriesJson from "../data/countries.json";

export const COUNTRIES = countriesJson as Country[];
export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const countryName = (code: string) => COUNTRY_BY_CODE.get(code)?.name ?? code;

export interface CategoryMeta {
  id: Category;
  label: string;
  color: string;
}

// Colours only carry meaning (the story's category); hues are spaced for legibility on the dark globe.
export const CATEGORIES: CategoryMeta[] = [
  { id: "world", label: "World", color: "#C9D3E3" },
  { id: "politics", label: "Politics", color: "#8C9BFF" },
  { id: "conflict", label: "Conflict", color: "#FF6B6B" },
  { id: "business", label: "Business", color: "#4CC3FF" },
  { id: "technology", label: "Technology", color: "#2EE6C5" },
  { id: "science", label: "Science", color: "#C58BFF" },
  { id: "health", label: "Health", color: "#5BE38A" },
  { id: "climate", label: "Climate", color: "#B6E35A" },
  { id: "sports", label: "Sports", color: "#FF9F45" },
  { id: "entertainment", label: "Culture", color: "#FF73C6" },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<Category, CategoryMeta>;

export const TIME_RANGES: { id: TimeRange; label: string; ms: number }[] = [
  { id: "1h", label: "1 hour", ms: 3600e3 },
  { id: "6h", label: "6 hours", ms: 6 * 3600e3 },
  { id: "24h", label: "24 hours", ms: 24 * 3600e3 },
  { id: "72h", label: "3 days", ms: 72 * 3600e3 },
  { id: "all", label: "All", ms: Infinity },
];

export function flagUrl(code: string, w: 20 | 40 | 80 = 40) {
  return `https://flagcdn.com/w${w}/${code.toLowerCase()}.png`;
}

export function flagEmoji(code: string) {
  if (code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function faviconUrl(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function shortAgo(ts: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export const fmt = (n: number) => n.toLocaleString("en-US");
