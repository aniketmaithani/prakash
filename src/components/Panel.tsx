import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type PanelTab } from "../store";
import type { Article } from "../lib/types";
import { CATEGORIES, CATEGORY_BY_ID, COUNTRY_BY_CODE, TIME_RANGES, faviconUrl, flagUrl, fmt, timeAgo, shortAgo } from "../lib/meta";
import { useNow, type FeedMode } from "../lib/derive";
import { trendingTerms } from "../lib/trends";
import { solarTime, sunElevation } from "../lib/sun";
import { loadCountry, runSearch } from "../lib/api";
import { globe, openCountry, focusCountry } from "./Globe";
import { Icon } from "./Icon";

export function Flag({ code, size = 20 }: { code: string; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span className="flag flag-fallback" style={{ width: size * 1.4, height: size }}>{code}</span>;
  return <img className="flag" src={flagUrl(code, size > 22 ? 80 : 40)} alt="" width={Math.round(size * 1.4)} height={size} loading="lazy" onError={() => setOk(false)} />;
}

function Favicon({ host }: { host: string }) {
  const [ok, setOk] = useState(true);
  if (!ok || !host) return <span className="favicon favicon-fallback" aria-hidden="true">{(host || "?")[0]?.toUpperCase()}</span>;
  return <img className="favicon" src={faviconUrl(host)} alt="" width={16} height={16} loading="lazy" onError={() => setOk(false)} />;
}

export function openArticle(a: Article) {
  const s = useStore.getState();
  s.set({ openArticle: a, focusArticleId: a.id });
  s.markRead(a.id);
  const c = COUNTRY_BY_CODE.get(a.country);
  if (c) globe.current?.setFocus({ lat: c.lat, lng: c.lng }, CATEGORY_BY_ID[a.category].color);
}

async function copyLink(a: Article) {
  try {
    await navigator.clipboard.writeText(a.url);
    useStore.getState().toast("Link copied");
  } catch {
    useStore.getState().toast("Couldn’t copy. Your browser blocked clipboard access.");
  }
}

async function shareArticle(a: Article) {
  if (navigator.share) {
    try { await navigator.share({ title: a.title, url: a.url }); } catch { /* user cancelled */ }
  } else copyLink(a);
}

// ------------------------------------------------------------------ card
export function ArticleCard({ a, showCountry, focused, now }: { a: Article; showCountry: boolean; focused: boolean; now: number }) {
  const saved = useStore((s) => !!s.bookmarks[a.id]);
  const read = useStore((s) => !!s.readIds[a.id]);
  const [imgOk, setImgOk] = useState(true);
  const cat = CATEGORY_BY_ID[a.category];
  const fresh = now - a.publishedAt < 30 * 60e3;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focused]);

  return (
    <article
      ref={ref}
      className={`card${read ? " is-read" : ""}${focused ? " is-focused" : ""}`}
      onClick={() => openArticle(a)}
      onMouseEnter={() => { const c = COUNTRY_BY_CODE.get(a.country); if (c) globe.current?.setFocus({ lat: c.lat, lng: c.lng }, cat.color); }}
      onMouseLeave={() => { if (!useStore.getState().openArticle) globe.current?.setFocus(null); }}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") openArticle(a); }}
      aria-label={a.title}
    >
      <div className="card-body">
        <div className="card-meta">
          <Favicon host={a.host} />
          <span className="card-source">{a.source}</span>
          <span className="card-time" title={new Date(a.publishedAt).toLocaleString()}>{timeAgo(a.publishedAt, now)}</span>
          {fresh && <span className="pill-new">New</span>}
        </div>
        <h3 className="card-title">{a.title}</h3>
        <div className="card-foot">
          <span className="cat-tag" style={{ "--c": cat.color } as React.CSSProperties}>{cat.label}</span>
          {showCountry && (
            <button className="card-country" onClick={(e) => { e.stopPropagation(); openCountry(a.country); }} title={`Open ${COUNTRY_BY_CODE.get(a.country)?.name}`}>
              <Flag code={a.country} size={11} />
              {COUNTRY_BY_CODE.get(a.country)?.name}
            </button>
          )}
          {a.mentions.length > 0 && (
            <span className="card-mentions" title={`Also mentions ${a.mentions.map((m) => COUNTRY_BY_CODE.get(m)?.name).join(", ")}`}>
              <Icon name="arc" size={13} />
              {a.mentions.slice(0, 3).map((m) => <Flag key={m} code={m} size={10} />)}
            </span>
          )}
        </div>
      </div>
      {a.image && imgOk && (
        <div className="card-thumb">
          <img src={a.image} alt="" loading="lazy" onError={() => setImgOk(false)} />
        </div>
      )}
      <button
        className={`card-save${saved ? " is-on" : ""}`}
        onClick={(e) => { e.stopPropagation(); useStore.getState().toggleBookmark(a); }}
        aria-label={saved ? "Remove from reading list" : "Save to reading list"}
        title={saved ? "Remove from reading list" : "Save to reading list"}
      >
        <Icon name="bookmark" size={15} filled={saved} />
      </button>
    </article>
  );
}

function SkeletonList() {
  return (
    <div className="skeletons" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 90}ms` }}>
          <div className="sk sk-line w40" />
          <div className="sk sk-line w95" />
          <div className="sk sk-line w70" />
        </div>
      ))}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      {action && <button className="btn-quiet" onClick={action.run}>{action.label}</button>}
    </div>
  );
}

// ------------------------------------------------------------------ list
function StoryList({ items, mode, loading, error }: { items: Article[]; mode: FeedMode; loading: boolean; error?: string }) {
  const [limit, setLimit] = useState(40);
  const sentinel = useRef<HTMLDivElement>(null);
  const focusId = useStore((s) => s.focusArticleId);
  const category = useStore((s) => s.category);
  const timeRange = useStore((s) => s.timeRange);
  const selected = useStore((s) => s.selectedCountry);
  const now = useNow(30000);

  useEffect(() => setLimit(40), [mode, category, timeRange, selected]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((l) => l + 40); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length]);

  if (loading && !items.length) return <SkeletonList />;
  if (error && !items.length)
    return <Empty title="Stories didn’t load" body={error} action={selected ? { label: "Try again", run: () => loadCountry(selected, true) } : undefined} />;
  if (!items.length) {
    const s = useStore.getState();
    const catLabel = category === "all" ? "" : `${CATEGORY_BY_ID[category].label.toLowerCase()} `;
    const range = TIME_RANGES.find((t) => t.id === timeRange)!;
    if (category !== "all" || timeRange !== "all")
      return (
        <Empty
          title={`No ${catLabel}stories ${timeRange === "all" ? "here yet" : `in the past ${range.label}`}`}
          body="Widen the filters to see more of what’s being reported."
          action={{ label: "Clear filters", run: () => s.set({ category: "all", timeRange: "all" }) }}
        />
      );
    if (mode === "search") return <Empty title={`Nothing found for “${s.search?.query}”`} body="Try a broader term, a person’s surname, or a place name." />;
    return <Empty title="Waiting for the first stories" body="Newsrooms are being contacted now. Beacons light up on the globe as each country reports in." />;
  }

  return (
    <div className="story-list" role="feed" aria-busy={loading}>
      {items.slice(0, limit).map((a) => (
        <ArticleCard key={a.id} a={a} showCountry={mode !== "country"} focused={a.id === focusId} now={now} />
      ))}
      {limit < items.length && <div ref={sentinel} className="list-sentinel">Loading more stories</div>}
      {limit >= items.length && items.length > 8 && <p className="list-end">That’s every story in this view.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ headers
function CategoryStrip({ items }: { items: Article[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of items) m.set(a.category, (m.get(a.category) || 0) + 1);
    return CATEGORIES.map((c) => ({ ...c, n: m.get(c.id) || 0 })).filter((c) => c.n > 0);
  }, [items]);
  if (!items.length) return null;
  return (
    <div className="mix" aria-label="Stories by topic">
      <div className="mix-bar">
        {counts.map((c) => (
          <span key={c.id} style={{ flexGrow: c.n, background: c.color }} title={`${c.label}: ${c.n}`} />
        ))}
      </div>
      <div className="mix-legend">
        {counts.slice().sort((a, b) => b.n - a.n).slice(0, 4).map((c) => (
          <button key={c.id} onClick={() => useStore.getState().set({ category: c.id })}>
            <i style={{ background: c.color }} />{c.label} <b>{c.n}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({ mode, count, items, connections }: { mode: FeedMode; count: number; items: Article[]; connections: { code: string; count: number }[] }) {
  const selected = useStore((s) => s.selectedCountry);
  const search = useStore((s) => s.search);
  const status = useStore((s) => s.status);
  const articles = useStore((s) => s.articles);
  const feedState = useStore((s) => (selected ? s.countryFeeds[selected] : undefined));
  const now = useNow(60000);

  if (mode === "search" && search) {
    return (
      <header className="panel-head">
        <div className="panel-head-row">
          <button className="icon-btn" onClick={() => useStore.getState().set({ search: null })} aria-label="Clear search" title="Clear search">
            <Icon name="back" />
          </button>
          <div className="panel-head-text">
            <h2 className="panel-title">“{search.query}”</h2>
            <p className="panel-sub">{search.loading ? "Searching newsrooms worldwide…" : `${fmt(count)} stories, placed where they’re happening`}</p>
          </div>
        </div>
        <CategoryStrip items={items} />
      </header>
    );
  }

  if (mode === "country" && selected) {
    const c = COUNTRY_BY_CODE.get(selected)!;
    const elev = sunElevation(c.lat, c.lng, new Date(now));
    const daylight = elev > 0 ? "Daytime" : elev > -12 ? "Twilight" : "Night";
    return (
      <header className="panel-head">
        <div className="panel-head-row">
          <button className="icon-btn" onClick={() => { openCountry(null); globe.current?.setFocus(null); }} aria-label="Back to world view" title="Back to world view (Esc)">
            <Icon name="back" />
          </button>
          <Flag code={c.code} size={26} />
          <div className="panel-head-text">
            <h2 className="panel-title">{c.name}</h2>
            <p className="panel-sub">
              <span>{feedState?.loading ? "Gathering local coverage…" : `${fmt(count)} stories`}</span>
              <span className="daylight" title={`Sun is ${Math.round(elev)}° ${elev > 0 ? "above" : "below"} the horizon at the country's centre`}>
                <Icon name={elev > 0 ? "sun" : "moon"} size={13} /> {daylight}, {solarTime(c.lng, new Date(now))} local sun time
              </span>
            </p>
          </div>
          <button className="icon-btn" onClick={() => focusCountry(c.code)} aria-label="Centre on globe" title="Centre on globe">
            <Icon name="locate" />
          </button>
        </div>
        <CategoryStrip items={items} />
        {connections.length > 0 && (
          <div className="links-row">
            <span className="links-label">In headlines with</span>
            {connections.map((x) => (
              <button key={x.code} className="link-chip" onClick={() => openCountry(x.code)} title={`${x.count} stories link these countries`}>
                <Flag code={x.code} size={11} /> {COUNTRY_BY_CODE.get(x.code)?.name} <b>{x.count}</b>
              </button>
            ))}
          </div>
        )}
      </header>
    );
  }

  const countries = new Set(articles.map((a) => a.country)).size;
  return (
    <header className="panel-head">
      <div className="panel-head-text">
        <h2 className="panel-title">The world right now</h2>
        <p className="panel-sub">
          {articles.length ? `${fmt(count)} stories from ${countries} countries` : "Connecting to newsrooms…"}
          {status?.updatedAt ? <><span className="sep" /><span>updated {timeAgo(status.updatedAt, now)}</span></> : null}
        </p>
      </div>
      <CategoryStrip items={items} />
    </header>
  );
}

// ------------------------------------------------------------------ trends tab
function TrendsView({ items }: { items: Article[] }) {
  const trends = useMemo(() => trendingTerms(items, 16), [items]);
  const sources = useMemo(() => {
    const m = new Map<string, { n: number; host: string }>();
    for (const a of items) {
      const e = m.get(a.source) || { n: 0, host: a.host };
      e.n++;
      m.set(a.source, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }, [items]);
  const hours = useMemo(() => {
    const now = Date.now();
    const buckets = new Array(24).fill(0);
    for (const a of items) {
      const h = Math.floor((now - a.publishedAt) / 3600e3);
      if (h >= 0 && h < 24) buckets[23 - h]++;
    }
    return buckets;
  }, [items]);
  const maxH = Math.max(1, ...hours);
  const maxT = Math.max(1, ...trends.map((t) => t.count));

  if (!items.length) return <Empty title="Not enough stories yet" body="Trends appear once a few dozen stories have arrived." />;
  return (
    <div className="trends">
      <section>
        <h3 className="sub-title">Recurring names and topics</h3>
        <ol className="trend-list">
          {trends.map((t) => (
            <li key={t.term}>
              <button onClick={() => runSearch(t.term)} title={`Search all news for ${t.term}`}>
                <span className="trend-term">{t.term}</span>
                <span className="trend-bar"><i style={{ width: `${(t.count / maxT) * 100}%` }} /></span>
                <span className="trend-n">{t.count}</span>
              </button>
            </li>
          ))}
          {!trends.length && <li className="muted">No phrase repeats across enough stories yet.</li>}
        </ol>
      </section>
      <section>
        <h3 className="sub-title">Publishing in the last 24 hours</h3>
        <div className="spark" role="img" aria-label="Stories published per hour over the last day">
          {hours.map((n, i) => <i key={i} style={{ height: `${8 + (n / maxH) * 92}%` }} title={`${23 - i === 0 ? "This hour" : `${23 - i} hr ago`}: ${n}`} />)}
        </div>
        <div className="spark-axis"><span>24 hr ago</span><span>Now</span></div>
      </section>
      <section>
        <h3 className="sub-title">Most active outlets</h3>
        <ul className="source-list">
          {sources.map(([name, v]) => (
            <li key={name}><Favicon host={v.host} /><span>{name}</span><b>{v.n}</b></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ reader
function Reader({ a, pool }: { a: Article; pool: Article[] }) {
  const saved = useStore((s) => !!s.bookmarks[a.id]);
  const [imgOk, setImgOk] = useState(true);
  const c = COUNTRY_BY_CODE.get(a.country);
  const cat = CATEGORY_BY_ID[a.category];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); setImgOk(true); }, [a.id]);

  const related = useMemo(() => {
    const words = new Set(a.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
    return pool
      .filter((x) => x.id !== a.id)
      .map((x) => {
        const overlap = x.title.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
        return { x, score: overlap * 2 + (x.country === a.country ? 1 : 0) + (x.category === a.category ? 0.5 : 0) };
      })
      .filter((r) => r.score >= 2)
      .sort((p, q) => q.score - p.score)
      .slice(0, 5)
      .map((r) => r.x);
  }, [a, pool]);

  const close = () => { useStore.getState().set({ openArticle: null }); globe.current?.setFocus(null); };

  return (
    <div className="reader">
      <div className="reader-bar">
        <button className="btn-ghost" onClick={close}><Icon name="back" size={16} /> Stories</button>
        <div className="reader-actions">
          <button className={`icon-btn${saved ? " is-on" : ""}`} onClick={() => useStore.getState().toggleBookmark(a)} title={saved ? "Remove from reading list (S)" : "Save to reading list (S)"} aria-label="Save">
            <Icon name="bookmark" filled={saved} />
          </button>
          <button className="icon-btn" onClick={() => copyLink(a)} title="Copy link" aria-label="Copy link"><Icon name="link" /></button>
          <button className="icon-btn" onClick={() => shareArticle(a)} title="Share" aria-label="Share"><Icon name="share" /></button>
        </div>
      </div>
      <div className="reader-scroll" ref={scroller}>
        {a.image && imgOk && (
          <div className="reader-hero">
            <img src={a.image.replace("w=480&h=270", "w=960&h=540")} alt="" onError={() => setImgOk(false)} />
          </div>
        )}
        <div className="reader-meta">
          <Favicon host={a.host} />
          <span className="card-source">{a.source}</span>
          <span className="card-time">{timeAgo(a.publishedAt)}</span>
          <span className="cat-tag" style={{ "--c": cat.color } as React.CSSProperties}>{cat.label}</span>
        </div>
        <h2 className="reader-title">{a.title}</h2>
        {a.snippet && <p className="reader-snippet">{a.snippet}</p>}
        <a className="btn-primary" href={a.url} target="_blank" rel="noopener noreferrer">
          Read the full story on {a.host || a.source} <Icon name="external" size={16} />
        </a>
        <div className="reader-place">
          {c && (
            <button className="place-row" onClick={() => openCountry(c.code)}>
              <Flag code={c.code} size={18} />
              <span><b>{c.name}</b><small>Open all stories from here</small></span>
              <Icon name="chevron" size={16} />
            </button>
          )}
          {a.mentions.length > 0 && (
            <div className="links-row">
              <span className="links-label">Also mentions</span>
              {a.mentions.map((m) => (
                <button key={m} className="link-chip" onClick={() => openCountry(m)}>
                  <Flag code={m} size={11} /> {COUNTRY_BY_CODE.get(m)?.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {related.length > 0 && (
          <section className="related">
            <h3 className="sub-title">Related coverage</h3>
            {related.map((r) => (
              <button key={r.id} className="related-item" onClick={() => openArticle(r)}>
                <span className="related-meta"><Flag code={r.country} size={10} /> {r.source}<span className="sep" />{shortAgo(r.publishedAt)}</span>
                <span className="related-title">{r.title}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ panel
const TABS: { id: PanelTab; label: string; icon: string }[] = [
  { id: "stories", label: "Stories", icon: "stories" },
  { id: "trends", label: "Trends", icon: "trend" },
  { id: "saved", label: "Saved", icon: "saved" },
];

export function FeedPanel({ mode, feed, loading, error, connections }: { mode: FeedMode; feed: Article[]; loading: boolean; error?: string; connections: { code: string; count: number }[] }) {
  const tab = useStore((s) => s.tab);
  const open = useStore((s) => s.openArticle);
  const bookmarks = useStore((s) => s.bookmarks);
  const sheet = useStore((s) => s.sheet);
  const savedList = useMemo(() => Object.values(bookmarks).sort((a, b) => b.publishedAt - a.publishedAt), [bookmarks]);
  const drag = useRef<{ y: number } | null>(null);

  const cycleSheet = (dir: 1 | -1) => {
    const order = ["peek", "half", "full"] as const;
    const i = order.indexOf(useStore.getState().sheet);
    useStore.getState().set({ sheet: order[Math.max(0, Math.min(2, i + dir))] });
  };

  return (
    <section className={`panel sheet-${sheet}`} aria-label="News stories">
      <div
        className="sheet-handle"
        onPointerDown={(e) => { drag.current = { y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => {
          const dy = drag.current ? e.clientY - drag.current.y : 0;
          drag.current = null;
          if (dy < -30) cycleSheet(1);
          else if (dy > 30) cycleSheet(-1);
          else useStore.getState().set({ sheet: sheet === "peek" ? "half" : sheet === "half" ? "full" : "peek" });
        }}
        role="button"
        aria-label="Resize stories panel"
      >
        <i />
      </div>
      {open ? (
        <Reader a={open} pool={feed.length ? feed : savedList} />
      ) : (
        <>
          <PanelHeader mode={mode} count={feed.length} items={feed} connections={connections} />
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => useStore.getState().set({ tab: t.id, sheet: sheet === "peek" ? "half" : sheet })}>
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.id === "saved" && savedList.length > 0 && <span className="tab-count">{savedList.length}</span>}
              </button>
            ))}
          </nav>
          <div className="panel-scroll">
            {tab === "stories" && <StoryList items={feed} mode={mode} loading={loading} error={error} />}
            {tab === "trends" && <TrendsView items={feed} />}
            {tab === "saved" &&
              (savedList.length ? (
                <div className="story-list">
                  {savedList.map((a) => <ArticleCard key={a.id} a={a} showCountry focused={false} now={Date.now()} />)}
                </div>
              ) : (
                <Empty title="Your reading list is empty" body="Tap the bookmark on any story to keep it here. Saved stories stay on this device, even after you close the tab." />
              ))}
          </div>
        </>
      )}
    </section>
  );
}

export { copyLink, shareArticle };
