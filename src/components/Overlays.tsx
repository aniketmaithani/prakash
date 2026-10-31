import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { Article } from "../lib/types";
import { CATEGORIES, CATEGORY_BY_ID, COUNTRIES, COUNTRY_BY_CODE, TIME_RANGES, fmt, timeAgo } from "../lib/meta";
import { runSearch } from "../lib/api";
import { globe, openCountry } from "./Globe";
import { Flag, openArticle } from "./Panel";
import { Icon, Logo } from "./Icon";

// ------------------------------------------------------------------ hover tooltip
export function HoverCard({ code, x, y, articles }: { code: string; x: number; y: number; articles: Article[] }) {
  const c = COUNTRY_BY_CODE.get(code);
  if (!c || x < 0) return null;
  const list = articles.filter((a) => a.country === code);
  const top = list[0];
  const counts = new Map<string, number>();
  for (const a of list) counts.set(a.category, (counts.get(a.category) || 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const w = 300;
  const left = Math.min(window.innerWidth - w - 12, x + 18);
  const top_ = Math.min(window.innerHeight - 170, y + 18);
  return (
    <div className="hovercard" style={{ left, top: top_, width: w }} role="tooltip">
      <div className="hc-head">
        <Flag code={code} size={16} />
        <b>{c.name}</b>
        <span className="hc-count">{list.length ? `${list.length} ${list.length === 1 ? "story" : "stories"}` : "No stories in view"}</span>
      </div>
      {cats.length > 0 && (
        <div className="hc-cats">
          {cats.map(([cat, n]) => (
            <span key={cat} style={{ "--c": CATEGORY_BY_ID[cat as Article["category"]].color } as React.CSSProperties}>
              <i />{CATEGORY_BY_ID[cat as Article["category"]].label} {n}
            </span>
          ))}
        </div>
      )}
      {top && <p className="hc-title">{top.title}</p>}
      <p className="hc-hint">{top ? `${top.source}, ${timeAgo(top.publishedAt)}. Click to open ${c.name}.` : `Click to load ${c.name}’s newsrooms.`}</p>
    </div>
  );
}

// ------------------------------------------------------------------ command palette
interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const articles = useStore((s) => s.articles);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const setSettings = useStore((s) => s.setSettings);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQ(useStore.getState().search?.query || ""); setActive(0); requestAnimationFrame(() => input.current?.select()); }
  }, [open]);

  const close = () => set({ paletteOpen: false });

  const cmds = useMemo<Cmd[]>(() => {
    const query = q.trim().toLowerCase();
    const out: Cmd[] = [];
    const counts = new Map<string, number>();
    for (const a of articles) counts.set(a.country, (counts.get(a.country) || 0) + 1);

    if (query) {
      out.push({ id: "search", group: "Search", label: `Search all news for “${q.trim()}”`, hint: "Enter", icon: <Icon name="search" size={16} />, run: () => runSearch(q) });
      const countries = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase() === query || c.aliases.some((a) => a.toLowerCase().startsWith(query)))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(query)) - Number(a.name.toLowerCase().startsWith(query)) || (counts.get(b.code) || 0) - (counts.get(a.code) || 0))
        .slice(0, 6);
      for (const c of countries) out.push({ id: `c-${c.code}`, group: "Countries", label: c.name, hint: counts.get(c.code) ? `${counts.get(c.code)} stories` : "Load stories", icon: <Flag code={c.code} size={13} />, run: () => openCountry(c.code) });
      // If the query names a country exactly, opening it is what people expect from Enter.
      if (countries[0] && countries[0].name.toLowerCase() === query) out.unshift(out.splice(1, 1)[0]);
      const words = query.split(/\s+/);
      const heads = articles.filter((a) => words.every((w) => a.title.toLowerCase().includes(w))).slice(0, 6);
      for (const a of heads) out.push({ id: `a-${a.id}`, group: "Headlines on the globe", label: a.title, hint: a.source, icon: <Flag code={a.country} size={11} />, run: () => openArticle(a) });
      for (const c of CATEGORIES.filter((c) => c.label.toLowerCase().startsWith(query)))
        out.push({ id: `t-${c.id}`, group: "Topics", label: `Show ${c.label.toLowerCase()} stories`, icon: <i className="dot" style={{ background: c.color }} />, run: () => set({ category: c.id }) });
    } else {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [code, n] of top) out.push({ id: `c-${code}`, group: "Busiest newsrooms", label: COUNTRY_BY_CODE.get(code)?.name || code, hint: `${n} stories`, icon: <Flag code={code} size={13} />, run: () => openCountry(code) });
    }
    const actions: Cmd[] = [
      { id: "x-brief", group: "Actions", label: "Start the world briefing", hint: "B", icon: <Icon name="play" size={15} />, run: () => startBriefing() },
      { id: "x-saved", group: "Actions", label: "Open reading list", icon: <Icon name="bookmark" size={15} />, run: () => set({ tab: "saved", openArticle: null, sheet: "half" }) },
      { id: "x-trends", group: "Actions", label: "Show trends", icon: <Icon name="trend" size={15} />, run: () => set({ tab: "trends", openArticle: null, sheet: "half" }) },
      { id: "x-world", group: "Actions", label: "Back to world view", hint: "Esc", icon: <Icon name="globe" size={15} />, run: () => { openCountry(null); set({ search: null }); globe.current?.resetView(); } },
      { id: "x-arcs", group: "Actions", label: `${settings.arcs ? "Hide" : "Show"} connections`, hint: "A", icon: <Icon name="arc" size={15} />, run: () => setSettings({ arcs: !settings.arcs }) },
      { id: "x-heat", group: "Actions", label: `${settings.heat ? "Hide" : "Show"} coverage heat`, hint: "H", icon: <Icon name="layers" size={15} />, run: () => setSettings({ heat: !settings.heat }) },
      { id: "x-clouds", group: "Actions", label: `${settings.clouds ? "Hide" : "Show"} clouds`, hint: "C", icon: <Icon name="sun" size={15} />, run: () => setSettings({ clouds: !settings.clouds }) },
      { id: "x-rotate", group: "Actions", label: `${settings.autoRotate ? "Stop" : "Start"} auto-rotate`, hint: "R", icon: <Icon name="rotate" size={15} />, run: () => setSettings({ autoRotate: !settings.autoRotate }) },
      { id: "x-keys", group: "Actions", label: "Keyboard shortcuts", hint: "?", icon: <Icon name="keyboard" size={15} />, run: () => set({ shortcutsOpen: true }) },
    ];
    const qa = q.trim().toLowerCase();
    out.push(...(qa ? actions.filter((a) => a.label.toLowerCase().includes(qa)) : actions));
    return out;
  }, [q, articles, settings, set, setSettings]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const exec = (c?: Cmd) => { if (!c) return; close(); c.run(); };
  let lastGroup = "";

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-label="Search and commands">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a country, topic or person"
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(cmds.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); exec(cmds[active]); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={list} role="listbox">
          {cmds.map((c, i) => {
            const header = c.group !== lastGroup ? <p className="palette-group">{c.group}</p> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header}
                <button data-i={i} role="option" aria-selected={i === active} className={`palette-item${i === active ? " is-on" : ""}`} onMouseMove={() => setActive(i)} onClick={() => exec(c)}>
                  <span className="pi-icon">{c.icon}</span>
                  <span className="pi-label">{c.label}</span>
                  {c.hint && <span className="pi-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span className="grow" />
          <span>{fmt(articles.length)} stories indexed</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ briefing
export function startBriefing() {
  const s = useStore.getState();
  const maxAge = TIME_RANGES.find((t) => t.id === s.timeRange)!.ms;
  const now = Date.now();
  const src = (s.search ? s.search.articles : s.articles).filter((a) => now - a.publishedAt <= maxAge && (s.category === "all" || a.category === s.category));
  const by = new Map<string, Article[]>();
  for (const a of src) by.set(a.country, [...(by.get(a.country) || []), a]);
  const picks = [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([, list]) => list.find((a) => a.image && now - a.publishedAt < 12 * 3600e3) || list[0]);
  if (picks.length < 2) {
    s.toast("Not enough stories for a briefing yet. Try again once more countries report in.");
    return;
  }
  // Sweep east to west, following the day as it moves across the planet.
  picks.sort((a, b) => (COUNTRY_BY_CODE.get(b.country)?.lng || 0) - (COUNTRY_BY_CODE.get(a.country)?.lng || 0));
  s.selectCountry(null);
  s.set({ briefing: { active: true, index: 0, paused: false, items: picks }, openArticle: null, paletteOpen: false, layersOpen: false });
}

const STEP_MS = 9000;

export function Briefing() {
  const b = useStore((s) => s.briefing);
  const set = useStore((s) => s.set);
  const item = b.items[b.index];
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    if (!b.active || !item) return;
    const c = COUNTRY_BY_CODE.get(item.country);
    if (c) {
      globe.current?.flyTo(c.lat, c.lng, 2.05);
      globe.current?.setFocus({ lat: c.lat, lng: c.lng }, CATEGORY_BY_ID[item.category].color);
    }
    setImgOk(true);
  }, [b.active, b.index, item]);

  useEffect(() => {
    if (!b.active || b.paused) return;
    const t = setTimeout(() => go(1), STEP_MS);
    return () => clearTimeout(t);
  }); // re-armed each render so pausing/resuming restarts the step cleanly

  const go = (d: number) => {
    const s = useStore.getState().briefing;
    const next = s.index + d;
    if (next >= s.items.length) return stop(true);
    set({ briefing: { ...s, index: Math.max(0, next), paused: false } });
  };
  const stop = (finished = false) => {
    set({ briefing: { ...useStore.getState().briefing, active: false } });
    globe.current?.setFocus(null);
    if (finished) useStore.getState().toast("Briefing finished");
  };

  if (!b.active || !item) return null;
  const c = COUNTRY_BY_CODE.get(item.country);
  const cat = CATEGORY_BY_ID[item.category];
  return (
    <div className="briefing" role="region" aria-label="World briefing">
      <div className="brief-steps" aria-label={`Story ${b.index + 1} of ${b.items.length}`}>
        {b.items.map((x, i) => (
          <button key={x.id} className={i < b.index ? "done" : i === b.index ? "now" : ""} onClick={() => set({ briefing: { ...b, index: i, paused: false } })} aria-label={`Go to ${COUNTRY_BY_CODE.get(x.country)?.name}`}>
            <i style={i === b.index ? { animationDuration: `${STEP_MS}ms`, animationPlayState: b.paused ? "paused" : "running" } : undefined} key={i === b.index ? `${b.index}-${b.paused}` : undefined} />
          </button>
        ))}
      </div>
      <div className="brief-card" key={item.id}>
        {item.image && imgOk && <img className="brief-img" src={item.image} alt="" onError={() => setImgOk(false)} />}
        <div className="brief-text">
          <p className="brief-place">
            {c && <Flag code={c.code} size={14} />}
            <span>{c?.name}</span>
            <span className="cat-tag" style={{ "--c": cat.color } as React.CSSProperties}>{cat.label}</span>
            <span className="brief-count">{b.index + 1} of {b.items.length}</span>
          </p>
          <h2 className="brief-title">{item.title}</h2>
          <p className="brief-src">{item.source}, {timeAgo(item.publishedAt)}</p>
        </div>
      </div>
      <div className="brief-controls">
        <button className="icon-btn" onClick={() => go(-1)} disabled={b.index === 0} aria-label="Previous story" title="Previous (←)"><Icon name="prev" size={16} /></button>
        <button className="icon-btn big" onClick={() => set({ briefing: { ...b, paused: !b.paused } })} aria-label={b.paused ? "Resume" : "Pause"} title={b.paused ? "Resume (Space)" : "Pause (Space)"}>
          <Icon name={b.paused ? "play" : "pause"} size={18} filled />
        </button>
        <button className="icon-btn" onClick={() => go(1)} aria-label="Next story" title="Next (→)"><Icon name="next" size={16} /></button>
        <span className="grow" />
        <button className="btn-ghost" onClick={() => { set({ briefing: { ...b, paused: true } }); openArticle(item); }}>Read story</button>
        <button className="btn-ghost" onClick={() => stop()}>End briefing</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ splash
export function Splash() {
  const ready = useStore((s) => s.globeReady);
  const p = useStore((s) => s.textureProgress);
  const status = useStore((s) => s.status);
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t1 = setTimeout(() => setLeaving(true), 250);
    const t2 = setTimeout(() => { setGone(true); useStore.getState().set({ splashDone: true }); }, 1350);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [ready]);
  if (gone) return null;
  const line = p < 1 ? `Loading Earth imagery, ${Math.round(p * 100)}%` : status?.refreshing ? `Contacting newsrooms, ${status.progress.done} of ${status.progress.total}` : "Bringing the globe online";
  return (
    <div className={`splash${leaving ? " is-leaving" : ""}`} aria-live="polite">
      <div className="splash-inner">
        <Logo size={56} />
        <h1 className="splash-name">Prakash</h1>
        <p className="splash-tag">What every country is reporting, as it happens.</p>
        <div className="splash-bar"><i style={{ width: `${Math.max(4, p * 100)}%` }} /></div>
        <p className="splash-line">{line}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modals
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["⌘ K  or  /", "Search countries, topics and commands"],
  ["Esc", "Close, or step back to the world view"],
  ["J  K", "Next and previous story in the list"],
  ["Enter", "Open the highlighted story"],
  ["S", "Save the open story"],
  ["[  ]", "Previous and next topic"],
  ["B", "Start or stop the briefing"],
  ["Space", "Pause the briefing"],
  ["← →", "Previous and next briefing story"],
  ["+  −", "Zoom in and out"],
  ["0", "Reset the view"],
  ["R", "Auto-rotate"],
  ["A  H  C", "Connections, heat, clouds"],
  ["L", "Map layers"],
];

export function ShortcutsModal() {
  const open = useStore((s) => s.shortcutsOpen);
  const set = useStore((s) => s.set);
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => set({ shortcutsOpen: false })}>
      <dl className="keys">
        {KEYS.map(([k, d]) => (
          <div key={k}><dt>{k.split("  ").map((x) => <kbd key={x}>{x}</kbd>)}</dt><dd>{d}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}

export function AboutModal() {
  const open = useStore((s) => s.aboutOpen);
  const set = useStore((s) => s.set);
  if (!open) return null;
  return (
    <Modal title="About Prakash" onClose={() => set({ aboutOpen: false })} wide>
      <div className="about">
        <p className="about-lede">Prakash maps what newsrooms in more than 180 countries are reporting right now. Each light pillar is a country; its height is how much coverage it has. Arcs connect countries that appear in the same headline.</p>
        <div className="about-grid">
          <div>
            <h3>How to use it</h3>
            <ul>
              <li>Drag to turn the globe, scroll or pinch to zoom.</li>
              <li>Click a country to read its local coverage.</li>
              <li>Search any topic to see where in the world it’s being reported.</li>
              <li>Start a briefing for a guided tour of the day’s top stories.</li>
            </ul>
          </div>
          <div>
            <h3>Topic colours</h3>
            <ul className="about-legend">
              {CATEGORIES.map((c) => <li key={c.id}><i style={{ background: c.color }} />{c.label}</li>)}
            </ul>
          </div>
        </div>
        <h3>Sources and credits</h3>
        <p className="about-small">
          Headlines are gathered from Bing News and link straight to each publisher. Topics are assigned automatically from headline wording and can be wrong.
          Earth imagery by Solar System Scope, based on NASA data (CC BY 4.0). Country shapes from Natural Earth via world-atlas. Flags by flagcdn.
          Prakash started as a redesign of <a href="https://newsglobe.saurabhn.com/" target="_blank" rel="noreferrer">NewsGlobe</a> by
          Saurabh Nandedkar (<a href="https://github.com/EXTREMOPHILARUM" target="_blank" rel="noreferrer">@EXTREMOPHILARUM</a>). The idea is his.
        </p>
      </div>
    </Modal>
  );
}
