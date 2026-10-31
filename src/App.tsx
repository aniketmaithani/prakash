import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { useDerived } from "./lib/derive";
import { startPolling, runSearch, loadCountry } from "./lib/api";
import { CATEGORIES, CATEGORY_BY_ID, COUNTRY_BY_CODE } from "./lib/meta";
import { Globe, globe, openCountry, focusCountry } from "./components/Globe";
import { FeedPanel, openArticle } from "./components/Panel";
import { TopBar, LeftRail, BottomBar, GlobeControls, CategoryChips } from "./components/Chrome";
import { HoverCard, CommandPalette, Briefing, Splash, Toasts, ShortcutsModal, AboutModal, startBriefing } from "./components/Overlays";

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export default function App() {
  const d = useDerived();
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const category = useStore((s) => s.category);
  const selected = useStore((s) => s.selectedCountry);
  const search = useStore((s) => s.search);
  const briefing = useStore((s) => s.briefing.active);
  const ticker = useStore((s) => s.settings.ticker);
  const splashDone = useStore((s) => s.splashDone);
  const sheet = useStore((s) => s.sheet);
  const mobile = useMedia("(max-width: 860px)");
  const narrow = useMedia("(max-width: 1180px)");

  useEffect(() => startPolling(), []);

  // ---- shareable URL state: #country=KE, #q=elections, &topic=sports
  useEffect(() => {
    let first = true;
    const apply = () => {
      const p = new URLSearchParams(location.hash.slice(1));
      const s = useStore.getState();
      const topic = p.get("topic");
      if (topic && CATEGORIES.some((c) => c.id === topic)) s.set({ category: topic as never });
      const q = p.get("q");
      const c = p.get("country")?.toUpperCase();
      if (q && q !== s.search?.query) runSearch(q);
      else if (c && COUNTRY_BY_CODE.has(c) && c !== s.selectedCountry) {
        if (first) {
          // Wait for the intro flight to finish before flying to the shared country.
          s.selectCountry(c);
          loadCountry(c);
          const wait = setInterval(() => {
            if (useStore.getState().globeReady) { clearInterval(wait); setTimeout(() => focusCountry(c), 2600); }
          }, 200);
        } else openCountry(c);
      }
      first = false;
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set("q", search.query);
    else if (selected) p.set("country", selected);
    if (category !== "all") p.set("topic", category);
    const h = p.toString();
    history.replaceState(null, "", h ? `#${h}` : location.pathname);
    const name = search ? `“${search.query}”` : selected ? COUNTRY_BY_CODE.get(selected)?.name : null;
    document.title = name ? `${name} · Prakash` : "Prakash · Live world news globe";
  }, [search, selected, category]);

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); s.set({ paletteOpen: !s.paletteOpen }); return; }
      if (s.paletteOpen || s.shortcutsOpen || s.aboutOpen) return;
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const feed = d.feed;
      const idx = feed.findIndex((a) => a.id === s.focusArticleId);
      const b = s.briefing;
      switch (e.key) {
        case "/": e.preventDefault(); s.set({ paletteOpen: true }); break;
        case "?": s.set({ shortcutsOpen: true }); break;
        case "Escape":
          if (s.layersOpen) s.set({ layersOpen: false });
          else if (b.active) { s.set({ briefing: { ...b, active: false } }); globe.current?.setFocus(null); }
          else if (s.openArticle) { s.set({ openArticle: null }); globe.current?.setFocus(null); }
          else if (s.search) s.set({ search: null });
          else if (s.selectedCountry) openCountry(null);
          break;
        case "j": case "ArrowDown":
          if (b.active || !feed.length) break;
          e.preventDefault();
          s.set({ focusArticleId: feed[Math.min(feed.length - 1, idx + 1)].id, tab: "stories" });
          if (s.openArticle) openArticle(feed[Math.min(feed.length - 1, idx + 1)]);
          break;
        case "k": case "ArrowUp":
          if (b.active || !feed.length) break;
          e.preventDefault();
          s.set({ focusArticleId: feed[Math.max(0, idx - 1)].id, tab: "stories" });
          if (s.openArticle) openArticle(feed[Math.max(0, idx - 1)]);
          break;
        case "Enter": if (idx >= 0 && !s.openArticle) openArticle(feed[idx]); break;
        case "s": if (s.openArticle) s.toggleBookmark(s.openArticle); break;
        case "b": if (b.active) s.set({ briefing: { ...b, active: false } }); else startBriefing(); break;
        case " ": if (b.active) { e.preventDefault(); s.set({ briefing: { ...b, paused: !b.paused } }); } break;
        case "ArrowRight": if (b.active) s.set({ briefing: { ...b, index: Math.min(b.items.length - 1, b.index + 1), paused: false } }); break;
        case "ArrowLeft": if (b.active) s.set({ briefing: { ...b, index: Math.max(0, b.index - 1), paused: false } }); break;
        case "[": case "]": {
          const ids = ["all", ...CATEGORIES.map((c) => c.id)] as const;
          const i = ids.indexOf(s.category);
          s.set({ category: ids[(i + (e.key === "]" ? 1 : ids.length - 1)) % ids.length] });
          break;
        }
        case "+": case "=": globe.current?.zoomBy(0.75); break;
        case "-": case "_": globe.current?.zoomBy(1.33); break;
        case "0": globe.current?.resetView(); break;
        case "r": s.setSettings({ autoRotate: !s.settings.autoRotate }); s.toast(`Auto-rotate ${s.settings.autoRotate ? "off" : "on"}`); break;
        case "a": s.setSettings({ arcs: !s.settings.arcs }); s.toast(`Connections ${s.settings.arcs ? "hidden" : "shown"}`); break;
        case "h": s.setSettings({ heat: !s.settings.heat }); s.toast(`Coverage heat ${s.settings.heat ? "off" : "on"}`); break;
        case "c": s.setSettings({ clouds: !s.settings.clouds }); s.toast(`Clouds ${s.settings.clouds ? "hidden" : "shown"}`); break;
        case "l": s.set({ layersOpen: !s.layersOpen }); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d.feed]);

  // ---- keep the globe optically centred in the space the panels leave free
  const insets = useMemo(() => {
    if (briefing) return { left: 0, right: 0, top: 0, bottom: mobile ? 220 : 200 };
    if (mobile) return { left: 0, right: 0, top: 96, bottom: sheet === "peek" ? 150 : sheet === "half" ? window.innerHeight * 0.5 : 0 };
    return { left: narrow ? 0 : 280, right: 436, top: 70, bottom: ticker ? 76 : 76 };
  }, [briefing, mobile, narrow, sheet, ticker]);

  const onHover = useCallback((code: string | null, x: number, y: number) => setHover(code ? { code, x, y } : null), []);
  const heatColor = category === "all" ? "#FFB45E" : CATEGORY_BY_ID[category].color;

  return (
    <div className={`app${briefing ? " is-briefing" : ""}${splashDone ? " is-ready" : ""}${mobile ? " is-mobile" : ""}`}>
      <Globe beacons={d.beacons} arcs={d.arcs} labels={d.labels} heat={d.heat} heatColor={heatColor} onHover={onHover} insets={insets} />
      <div className="vignette" aria-hidden="true" />
      <TopBar />
      {mobile && <div className="mobile-cats"><CategoryChips counts={d.categoryCounts} compact /></div>}
      {!mobile && !narrow && <LeftRail counts={d.categoryCounts} mapArticles={d.mapArticles} countryRank={d.countryRank} topPairs={d.topPairs} />}
      {narrow && !mobile && <div className="float-cats"><CategoryChips counts={d.categoryCounts} compact /></div>}
      <FeedPanel mode={d.mode} feed={d.feed} loading={d.feedLoading} error={d.feedError} connections={d.connections} />
      <GlobeControls />
      {!mobile && <BottomBar tickerItems={d.mapArticles} />}
      {hover && !mobile && !briefing && <HoverCard code={hover.code} x={hover.x} y={hover.y} articles={d.mapArticles} />}
      <Briefing />
      <CommandPalette />
      <ShortcutsModal />
      <AboutModal />
      <Toasts />
      <Splash />
    </div>
  );
}
