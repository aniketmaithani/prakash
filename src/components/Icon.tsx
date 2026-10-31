const PATHS: Record<string, string> = {
  search: "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm10.5 3-5.2-5.2",
  close: "M6 6l12 12M18 6 6 18",
  bookmark: "M6.5 3.5h11v17l-5.5-4-5.5 4z",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  play: "M7 4.5v15l12-7.5z",
  pause: "M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z",
  next: "M5 5l9 7-9 7zM18 5v14",
  prev: "M19 5l-9 7 9 7zM6 5v14",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  home: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v2m0 6v2m-5-5h2m6 0h2",
  rotate: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5",
  layers: "M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5",
  keyboard: "M3 6.5h18v11H3zM6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7 14h10",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5v.5",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  refresh: "M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5",
  locate: "M12 2v3M12 19v3M2 12h3M19 12h3M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  saved: "M6.5 3.5h11v17l-5.5-4-5.5 4z",
  stories: "M4 5h16M4 10h16M4 15h10M4 20h7",
  briefing: "M4 6h16v10H4zM9 20h6M12 16v4M10 9.5v3l3-1.5z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  arc: "M4 18c2-8 14-8 16 0M4 18h.01M20 18h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  share: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
};

export function Icon({ name, size = 18, filled = false, className }: { name: keyof typeof PATHS | string; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Prakash mark: a globe crossed by a single line of light. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="lg-a" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#5c8dff" />
          <stop offset="0.6" stopColor="#14306e" />
          <stop offset="1" stopColor="#050b1d" />
        </radialGradient>
        <linearGradient id="lg-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD6A0" />
          <stop offset="1" stopColor="#FF9B3D" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#lg-a)" />
      <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(160,200,255,.45)" strokeWidth="1" />
      <path d="M16 3c4.6 3.4 6.8 7.7 6.8 13S20.6 25.6 16 29" fill="none" stroke="url(#lg-b)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="21.3" cy="11.5" r="1.7" fill="#FFE2BC" />
    </svg>
  );
}
