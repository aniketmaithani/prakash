import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { Article, Settings } from "../lib/types";
import { CATEGORIES, COUNTRY_BY_CODE, TIME_RANGES, fmt, shortAgo, timeAgo } from "../lib/meta";
import { useNow } from "../lib/derive";
import { trendingTerms } from "../lib/trends";
import { runSearch } from "../lib/api";
import { globe, openCountry } from "./Globe";
import { Flag, openArticle } from "./Panel";
import { Icon, Logo } from "./Icon";
import { startBriefing } from "./Overlays";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// ------------------------------------------------------------------ top bar
function LiveStatus() {
  const status = useStore((s) => s.status);
  const apiError = useStore((s) => s.apiError);
  const now = useNow(15000);
  if (apiError) return <span className="live live-error" role="status"><i />Offline, retrying</span>;
  if (!status) return <span className="live live-sync" role="status"><i />Connecting</span>;
  if (status.refreshing) {
    const pct = status.progress.total ? status.progress.done / status.progress.total : 0;
    return (
      <span className="live live-sync" role="status" title="Collecting the latest headlines from every country">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="2" />
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${pct * 34.6} 40`} transform="rotate(-90 7 7)" strokeLinecap="round" />
        </svg>
        Syncing {status.progress.done} of {status.progress.total}
      </span>
    );
  }
  return (
    <span className="live" role="status" title={status.updatedAt ? `Last full update ${new Date(status.updatedAt).toLocaleTimeString()}` : ""}>
      <i />Live{status.updatedAt ? <em>{timeAgo(status.updatedAt, now)}</em> : null}
    </span>
  );
}

function Clock() {
  const now = useNow(1000);
  const d = new Date(now);
  const utc = d.toISOString().slice(11, 16);
  const local = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="clock" title="Coordinated Universal Time and your local time">
      <b>{utc}</b> UTC<span className="sep" />{local} local
    </span>
  );
}

export function TopBar() {
  const search = useStore((s) => s.search);
  const set = useStore((s) => s.set);
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">Prakash</span>
        <LiveStatus />
      </div>
      <button className="searchbox" onClick={() => set({ paletteOpen: true })} aria-label="Search countries and news">
        <Icon name="search" size={16} />
        <span className={search ? "" : "placeholder"}>{search ? search.query : "Search a country, topic or person"}</span>
        <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="topbar-right">
        <Clock />
        <button className="btn-briefing" onClick={() => startBriefing()} title="Fly through the top story in each of the busiest countries (B)">
          <Icon name="play" size={14} filled /> Briefing
        </button>
        <button className="icon-btn" onClick={() => set({ shortcutsOpen: true })} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Icon name="keyboard" /></button>
        <button className="icon-btn" onClick={() => set({ aboutOpen: true })} title="About Prakash" aria-label="About"><Icon name="info" /></button>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ left rail
export function CategoryChips({ counts, compact = false }: { counts: Record<string, number>; compact?: boolean }) {
  const category = useStore((s) => s.category);
  const set = useStore((s) => s.set);
  const max = Math.max(1, ...CATEGORIES.map((c) => counts[c.id] || 0));
  const items = [{ id: "all" as const, label: "All topics", color: "#FFB45E" }, ...CATEGORIES];
  return (
    <ul className={compact ? "cat-chips" : "cat-list"} role="radiogroup" aria-label="Filter by topic">
      {items.map((c) => {
        const n = counts[c.id] || 0;
        const on = category === c.id;
        return (
          <li key={c.id}>
            <button role="radio" aria-checked={on} className={on ? "is-on" : ""} onClick={() => set({ category: c.id, focusArticleId: null })} style={{ "--c": c.color } as React.CSSProperties} disabled={!compact && c.id !== "all" && n === 0 && !on}>
              <i className="dot" />
              <span className="cat-label">{c.label}</span>
              {!compact && (c.id === "all" ? <span /> : <span className="cat-bar"><b style={{ width: `${(n / max) * 100}%` }} /></span>)}
              <span className="cat-n">{fmt(n)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LeftRail({ counts, mapArticles, countryRank, topPairs }: { counts: Record<string, number>; mapArticles: Article[]; countryRank: { code: string; count: number }[]; topPairs: { from: string; to: string; list: Article[] }[] }) {
  const trends = useMemo(() => trendingTerms(mapArticles, 9), [mapArticles]);
  const selected = useStore((s) => s.selectedCountry);
  return (
    <aside className="rail" aria-label="Topics and highlights">
      <section className="rail-section">
        <h2 className="rail-title">Topics</h2>
        <CategoryChips counts={counts} />
      </section>
      {trends.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-title">Trending in headlines</h2>
          <div className="trend-chips">
            {trends.map((t) => (
              <button key={t.term} onClick={() => runSearch(t.term)} title={`${t.count} stories from ${t.countries} ${t.countries === 1 ? "country" : "countries"}`}>
                {t.term}<b>{t.count}</b>
              </button>
            ))}
          </div>
        </section>
      )}
      {countryRank.length > 0 && (
        <section className="rail-section">
          <h2 className="rail-title" title="Stories from the country plus mentions in other countries’ headlines">Most in the news</h2>
          <ol className="rank-list">
            {countryRank.slice(0, 6).map((r) => (
              <li key={r.code}>
                <button className={selected === r.code ? "is-on" : ""} onClick={() => openCountry(r.code)}>
                  <Flag code={r.code} size={13} />
                  <span>{COUNTRY_BY_CODE.get(r.code)?.name}</span>
                  <b>{r.count}</b>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {topPairs.length > 0 && !selected && (
        <section className="rail-section">
          <h2 className="rail-title">Strongest connections</h2>
          <ul className="pair-list">
            {topPairs.slice(0, 4).map((p) => (
              <li key={p.from + p.to}>
                <button onClick={() => openCountry(p.from)} title={p.list[0]?.title}>
                  <Flag code={p.from} size={11} /><span className="pair-line" /><Flag code={p.to} size={11} />
                  <span className="pair-names">{COUNTRY_BY_CODE.get(p.from)?.name} and {COUNTRY_BY_CODE.get(p.to)?.name}</span>
                  <b>{p.list.length}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ bottom bar
function Ticker({ items }: { items: Article[] }) {
  const latest = useMemo(() => items.slice(0, 24), [items]);
  const now = useNow(60000);
  if (!latest.length) return <div className="ticker" />;
  const row = latest.map((a) => (
    <button key={a.id} className="tick" onClick={() => openArticle(a)}>
      <Flag code={a.country} size={10} />
      <span className="tick-time">{shortAgo(a.publishedAt, now)}</span>
      <span className="tick-title">{a.title}</span>
    </button>
  ));
  return (
    <div className="ticker" aria-label="Latest headlines">
      <span className="ticker-label">Latest</span>
      <div className="ticker-track">
        <div className="ticker-move" style={{ animationDuration: `${latest.length * 7}s` }}>
          {row}
          <span aria-hidden="true" className="ticker-dup">{row}</span>
        </div>
      </div>
    </div>
  );
}

export function BottomBar({ tickerItems }: { tickerItems: Article[] }) {
  const timeRange = useStore((s) => s.timeRange);
  const ticker = useStore((s) => s.settings.ticker);
  const set = useStore((s) => s.set);
  return (
    <footer className="bottombar">
      <div className="segmented" role="radiogroup" aria-label="Published within">
        <Icon name="clock" size={15} />
        {TIME_RANGES.map((t) => (
          <button key={t.id} role="radio" aria-checked={timeRange === t.id} className={timeRange === t.id ? "is-on" : ""} onClick={() => set({ timeRange: t.id })}>
            {t.id === "all" ? "Any time" : t.id}
          </button>
        ))}
      </div>
      {ticker && <Ticker items={tickerItems} />}
    </footer>
  );
}

// ------------------------------------------------------------------ globe controls & layers
function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text"><b>{label}</b><small>{hint}</small></span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

const LAYERS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "beacons", label: "Story beacons", hint: "Light pillars sized by coverage" },
  { key: "arcs", label: "Connections", hint: "Arcs between linked countries" },
  { key: "heat", label: "Coverage heat", hint: "Shade countries by story count" },
  { key: "labels", label: "Country names", hint: "Label the busiest countries" },
  { key: "borders", label: "Borders", hint: "Outline every country" },
  { key: "clouds", label: "Clouds", hint: "Cloud layer with shadows" },
  { key: "realSun", label: "Real-time daylight", hint: "Light Earth as the sun does now" },
  { key: "ultra", label: "8K imagery", hint: "Sharper surface, more memory" },
  { key: "ticker", label: "Headline ticker", hint: "Scrolling latest stories" },
];

export function GlobeControls() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const layersOpen = useStore((s) => s.layersOpen);
  const set = useStore((s) => s.set);
  const pop = useRef<HTMLDivElement>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!layersOpen) return;
    const close = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node)) set({ layersOpen: false }); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [layersOpen, set]);

  const locate = () => {
    if (!navigator.geolocation) return useStore.getState().toast("Location isn’t available in this browser");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        globe.current?.flyTo(p.coords.latitude, p.coords.longitude, 1.9);
        globe.current?.setFocus({ lat: p.coords.latitude, lng: p.coords.longitude }, "#7FD4FF");
        setTimeout(() => globe.current?.setFocus(null), 6000);
      },
      () => { setLocating(false); useStore.getState().toast("Location permission was declined"); },
      { timeout: 8000 }
    );
  };

  return (
    <div className="globe-controls" ref={pop}>
      <div className="ctrl-group">
        <button onClick={() => globe.current?.zoomBy(0.75)} title="Zoom in (+)" aria-label="Zoom in"><Icon name="plus" /></button>
        <button onClick={() => globe.current?.zoomBy(1.33)} title="Zoom out (−)" aria-label="Zoom out"><Icon name="minus" /></button>
      </div>
      <div className="ctrl-group">
        <button onClick={() => globe.current?.resetView()} title="Reset view (0)" aria-label="Reset view"><Icon name="home" /></button>
        <button className={settings.autoRotate ? "is-on" : ""} onClick={() => setSettings({ autoRotate: !settings.autoRotate })} title="Auto-rotate (R)" aria-label="Auto-rotate" aria-pressed={settings.autoRotate}><Icon name="rotate" /></button>
        <button className={locating ? "is-busy" : ""} onClick={locate} title="Go to my location" aria-label="Go to my location"><Icon name="locate" /></button>
      </div>
      <div className="ctrl-group">
        <button className={layersOpen ? "is-on" : ""} onClick={() => set({ layersOpen: !layersOpen })} title="Map layers (L)" aria-label="Map layers" aria-expanded={layersOpen}><Icon name="layers" /></button>
      </div>
      {layersOpen && (
        <div className="layers-pop" role="dialog" aria-label="Map layers">
          <p className="pop-title">Map layers</p>
          {LAYERS.map((l) => <Toggle key={l.key} label={l.label} hint={l.hint} on={settings[l.key]} onChange={(v) => setSettings({ [l.key]: v })} />)}
        </div>
      )}
    </div>
  );
}
