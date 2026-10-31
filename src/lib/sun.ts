// Subsolar point (where the sun is directly overhead) for a given instant.
// Accurate to a fraction of a degree, which is plenty for lighting a globe.
export function subsolarPoint(date = new Date()): { lat: number; lng: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const g = ((2 * Math.PI) / 365) * (day - 1);
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const lng = -((utcMinutes + eqTime) / 4 - 180);
  return { lat: (decl * 180) / Math.PI, lng: ((lng + 540) % 360) - 180 };
}

/** Sun elevation (degrees) above the horizon at a point — >0 is daytime. */
export function sunElevation(lat: number, lng: number, date = new Date()) {
  const s = subsolarPoint(date);
  const r = Math.PI / 180;
  const cos = Math.sin(lat * r) * Math.sin(s.lat * r) + Math.cos(lat * r) * Math.cos(s.lat * r) * Math.cos((lng - s.lng) * r);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cos))) / r;
}

/** Approximate local solar time, used only as a "roughly what time is it there" hint. */
export function solarTime(lng: number, date = new Date()) {
  const mins = (date.getUTCHours() * 60 + date.getUTCMinutes() + lng * 4 + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.floor(mins % 60)).padStart(2, "0")}`;
}
