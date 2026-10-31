// Builds public/geo/countries-50m.json from Natural Earth's India point-of-view countries.
//
// The default Natural Earth / world-atlas borders follow the line of control, which leaves
// Gilgit-Baltistan, PoK and Aksai Chin outside India. The India edition draws the whole of
// Jammu & Kashmir and Ladakh as Indian, so that's the one this app uses.
//
// Natural Earth only ships that edition at 1:10m, so it's simplified here to roughly the
// 1:50m detail the globe needs. Output matches world-atlas: ISO numeric ids, a name property.
//
//   node scripts/build-geo.mjs [path/to/ne_10m_admin_0_countries_ind.geojson]
import { readFileSync, writeFileSync } from "node:fs";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { quantize } from "topojson-client";

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson";
// Rough share of points to keep. 0.2 lands close to world-atlas 50m in size and detail.
const KEEP = Number(process.env.KEEP ?? 0.2);

const input = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], "utf8"))
  : await fetch(SOURCE).then((r) => { if (!r.ok) throw new Error(`download failed: ${r.status}`); return r.json(); });

const features = input.features.map((f) => {
  const p = f.properties;
  // ISO_N3 is -99 for a few countries with odd sovereignty records (France, Norway); the _EH field fixes those.
  const n3 = Number(p.ISO_N3) > 0 ? Number(p.ISO_N3) : Number(p.ISO_N3_EH);
  // Anything still without a code (Kosovo, Indian Ocean Ter.) is matched by name, like world-atlas.
  return { type: "Feature", id: n3 > 0 ? String(n3).padStart(3, "0") : undefined, properties: { name: p.NAME }, geometry: f.geometry };
});

let topo = topology({ countries: { type: "FeatureCollection", features } }, 1e6);
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, KEEP));
topo = quantize(topo, 1e5);

const out = new URL("../public/geo/countries-50m.json", import.meta.url);
writeFileSync(out, JSON.stringify(topo));
const points = topo.arcs.reduce((n, a) => n + a.length, 0);
console.log(`${features.length} countries, ${topo.arcs.length} arcs, ${points} points, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB`);
