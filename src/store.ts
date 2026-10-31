import { create } from "zustand";
import type { Article, Category, NewsStatus, Settings, TimeRange } from "./lib/types";

export type PanelTab = "stories" | "saved" | "trends";

interface CountryFeed {
  articles: Article[];
  loading: boolean;
  error?: string;
}

interface SearchState {
  query: string;
  articles: Article[];
  loading: boolean;
  error?: string;
}

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface Store {
  articles: Article[];
  status: NewsStatus | null;
  firstLoad: boolean;
  apiError: string | null;
  newSinceSeen: number;
  countryFeeds: Record<string, CountryFeed>;
  search: SearchState | null;

  category: Category | "all";
  timeRange: TimeRange;
  selectedCountry: string | null;
  hoveredCountry: string | null;
  openArticle: Article | null;
  focusArticleId: string | null;
  tab: PanelTab;

  bookmarks: Record<string, Article>;
  readIds: Record<string, number>;
  settings: Settings;

  paletteOpen: boolean;
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  layersOpen: boolean;
  sheet: "peek" | "half" | "full";
  globeReady: boolean;
  textureProgress: number;
  splashDone: boolean;

  briefing: { active: boolean; index: number; paused: boolean; items: Article[] };
  toasts: Toast[];

  set: (p: Partial<Store>) => void;
  setSettings: (p: Partial<Settings>) => void;
  selectCountry: (code: string | null) => void;
  toggleBookmark: (a: Article) => void;
  markRead: (id: string) => void;
  toast: (text: string, action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): keep working in memory */
  }
}

const isSmall = typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches;

export const DEFAULT_SETTINGS: Settings = {
  autoRotate: true,
  clouds: true,
  borders: true,
  beacons: true,
  arcs: true,
  heat: false,
  realSun: true,
  ticker: !isSmall,
  ultra: !isSmall,
  labels: true,
};

let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  articles: [],
  status: null,
  firstLoad: true,
  apiError: null,
  newSinceSeen: 0,
  countryFeeds: {},
  search: null,

  category: "all",
  timeRange: "all",
  selectedCountry: null,
  hoveredCountry: null,
  openArticle: null,
  focusArticleId: null,
  tab: "stories",

  bookmarks: load<Record<string, Article>>("prakash.bookmarks", {}),
  readIds: load<Record<string, number>>("prakash.read", {}),
  settings: load<Settings>("prakash.settings", DEFAULT_SETTINGS),

  paletteOpen: false,
  shortcutsOpen: false,
  aboutOpen: false,
  layersOpen: false,
  sheet: "peek",
  globeReady: false,
  textureProgress: 0,
  splashDone: false,

  briefing: { active: false, index: 0, paused: false, items: [] },
  toasts: [],

  set: (p) => set(p),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    save("prakash.settings", settings);
    set({ settings });
  },
  selectCountry: (code) => {
    set({ selectedCountry: code, openArticle: null, tab: "stories", search: code ? null : get().search, sheet: code ? "half" : get().sheet });
  },
  toggleBookmark: (a) => {
    const bookmarks = { ...get().bookmarks };
    const had = !!bookmarks[a.id];
    if (had) delete bookmarks[a.id];
    else bookmarks[a.id] = a;
    save("prakash.bookmarks", bookmarks);
    set({ bookmarks });
    get().toast(had ? "Removed from reading list" : "Saved to reading list");
  },
  markRead: (id) => {
    const readIds = { ...get().readIds, [id]: Date.now() };
    // Keep the history bounded so storage never grows without limit.
    const keys = Object.keys(readIds);
    if (keys.length > 800) for (const k of keys.sort((a, b) => readIds[a] - readIds[b]).slice(0, keys.length - 800)) delete readIds[k];
    save("prakash.read", readIds);
    set({ readIds });
  },
  toast: (text, action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, text, action }] });
    setTimeout(() => get().dismissToast(id), action ? 7000 : 2600);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
