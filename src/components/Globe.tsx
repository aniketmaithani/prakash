import { useEffect, useRef } from "react";
import { GlobeEngine, type ArcDatum, type BeaconDatum, type LabelDatum } from "../globe/GlobeEngine";
import { useStore } from "../store";
import { COUNTRY_BY_CODE } from "../lib/meta";
import { loadCountry } from "../lib/api";

/** Imperative handle other components use for camera moves. */
export const globe: { current: GlobeEngine | null } = { current: null };

export function focusCountry(code: string) {
  const c = COUNTRY_BY_CODE.get(code);
  if (!c) return;
  // Frame the country by its real size: closer for small states, further out for Russia or Canada.
  const g = globe.current;
  if (g) g.flyTo(c.lat, c.lng, g.focusDistance(c.size));
}

export function openCountry(code: string | null) {
  const s = useStore.getState();
  s.selectCountry(code);
  if (!code) {
    // Returning to the world view: pull back out so the whole planet is in frame again.
    const g = globe.current;
    if (g) {
      const v = g.getView();
      if (v.distance < g.fitDistance() * 0.9) g.flyTo(v.lat, v.lng, g.fitDistance());
    }
  }
  if (code) {
    focusCountry(code);
    loadCountry(code);
  }
}

interface Props {
  beacons: BeaconDatum[];
  arcs: ArcDatum[];
  labels: LabelDatum[];
  heat: Record<string, number>;
  heatColor: string;
  onHover: (code: string | null, x: number, y: number) => void;
  insets: { left: number; right: number; bottom: number; top: number };
}

export function Globe({ beacons, arcs, labels, heat, heatColor, onHover, insets }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const settings = useStore((s) => s.settings);
  const selected = useStore((s) => s.selectedCountry);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const s = useStore.getState();
    const engine = new GlobeEngine(host.current!, labelHost.current!, { ...s.settings }, {
      onHover: (code, x, y) => {
        useStore.getState().set({ hoveredCountry: code });
        hoverRef.current(code, x, y);
      },
      onClick: (code) => {
        const st = useStore.getState();
        if (st.briefing.active) st.set({ briefing: { ...st.briefing, active: false } });
        if (!code) {
          if (st.selectedCountry) openCountry(null);
          return;
        }
        openCountry(code === st.selectedCountry ? null : code);
      },
      onProgress: (p) => useStore.getState().set({ textureProgress: p }),
      onReady: () => useStore.getState().set({ globeReady: true }),
      onUserInteract: () => {
        const st = useStore.getState();
        if (st.briefing.active && !st.briefing.paused) st.set({ briefing: { ...st.briefing, paused: true } });
      },
    });
    globe.current = engine;
    return () => {
      engine.dispose();
      globe.current = null;
    };
  }, []);

  useEffect(() => { globe.current?.setOptions(settings); }, [settings]);
  useEffect(() => { globe.current?.setBeacons(beacons); }, [beacons]);
  useEffect(() => { globe.current?.setArcs(arcs); }, [arcs]);
  useEffect(() => { globe.current?.setLabels(labels); }, [labels]);
  useEffect(() => { globe.current?.setSelected(selected); }, [selected]);
  useEffect(() => { globe.current?.setHeat(settings.heat ? heat : null, heatColor); }, [heat, settings.heat, heatColor]);
  useEffect(() => { globe.current?.setInsets(insets); }, [insets.left, insets.right, insets.bottom, insets.top]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="globe-stage" aria-label="Interactive globe of world news. Drag to rotate, scroll to zoom, click a country to read its stories.">
      <div ref={host} className="globe-canvas" />
      <div ref={labelHost} className="globe-labels" />
    </div>
  );
}
