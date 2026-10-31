// Generates src/data/countries.json from world-atlas geometry.
// Run: node scripts/build-countries.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import { geoCentroid, geoArea } from "d3-geo";

const require = createRequire(import.meta.url);
const iso = require("i18n-iso-countries");
iso.registerLocale(require("i18n-iso-countries/langs/en.json"));

const topo50 = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-50m.json", import.meta.url)));
const topo110 = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-110m.json", import.meta.url)));

// Geometries without an ISO code, attached to the country that newsrooms file them under.
const UNCODED = { Kosovo: "XK", Somaliland: "SO", "N. Cyprus": "CY", "Siachen Glacier": "IN", "Indian Ocean Ter.": "AU" };

// Names people actually type and newsrooms actually print.
const NAME = {
  US: "United States", GB: "United Kingdom", KR: "South Korea", SY: "Syria", LA: "Laos", MD: "Moldova",
  CD: "DR Congo", CG: "Republic of the Congo", CZ: "Czech Republic", BN: "Brunei", CI: "Ivory Coast",
  GM: "Gambia", VA: "Vatican City", FK: "Falkland Islands", BO: "Bolivia", VE: "Venezuela", IR: "Iran",
  TZ: "Tanzania", RU: "Russia", VN: "Vietnam", TW: "Taiwan", PS: "Palestine", MK: "North Macedonia",
  FM: "Micronesia", KN: "Saint Kitts and Nevis", VC: "Saint Vincent", BA: "Bosnia and Herzegovina",
  TL: "Timor-Leste", XK: "Kosovo", TR: "Turkey", CV: "Cape Verde", MM: "Myanmar",
};
// Search phrasing where the display name is ambiguous for a news search.
const QUERY = { CG: "Congo-Brazzaville", CD: "DR Congo Kinshasa", GE: "Georgia Tbilisi", NE: "Niger Niamey", GN: "Guinea Conakry", JO: "Jordan Amman", CH: "Switzerland", TR: "Turkey OR Türkiye", PS: "Gaza OR West Bank OR Palestinian" };

// Small but newsworthy places that the coarse atlas leaves out; they still get a feed.
const EXTRA_NEWS = ["SG", "BH", "MT", "LU", "MU", "MV", "HK", "AD", "MC", "BB", "JM", "TT", "CY", "QA", "BS"];

// Demonyms and capitals so a headline like "Kenyan court…" or "Kremlin says…" links to its country.
const ALIASES = {
  US: ["US", "American", "Americans", "Washington", "White House", "U.S.", "Pentagon"], GB: ["British", "Britain", "UK", "London", "Downing Street", "England", "Scotland", "Wales"],
  IN: ["Indian", "New Delhi", "Mumbai"], CN: ["Chinese", "Beijing"], RU: ["Russian", "Moscow", "Kremlin", "Putin"], UA: ["Ukrainian", "Kyiv", "Zelensky", "Zelenskyy"],
  FR: ["French", "Paris", "Macron"], DE: ["German", "Berlin"], JP: ["Japanese", "Tokyo"], KR: ["South Korean", "Seoul"], KP: ["North Korean", "Pyongyang"],
  IL: ["Israeli", "Jerusalem", "Tel Aviv", "Netanyahu"], PS: ["Palestinian", "Gaza", "West Bank", "Hamas"], IR: ["Iranian", "Tehran"], IQ: ["Iraqi", "Baghdad"],
  SY: ["Syrian", "Damascus"], LB: ["Lebanese", "Beirut", "Hezbollah"], SA: ["Saudi", "Riyadh"], AE: ["UAE", "Emirati", "Dubai", "Abu Dhabi"], QA: ["Qatari", "Doha"],
  TR: ["Turkish", "Ankara", "Istanbul", "Erdogan", "Türkiye"], EG: ["Egyptian", "Cairo"], PK: ["Pakistani", "Islamabad", "Karachi"], AF: ["Afghan", "Kabul", "Taliban"],
  BD: ["Bangladeshi", "Dhaka"], LK: ["Sri Lankan", "Colombo"], NP: ["Nepali", "Nepalese", "Kathmandu"], CA: ["Canadian", "Ottawa", "Toronto"], MX: ["Mexican", "Mexico City"],
  BR: ["Brazilian", "Brasilia", "São Paulo", "Lula"], AR: ["Argentine", "Argentinian", "Buenos Aires"], CL: ["Chilean", "Santiago"], CO: ["Colombian", "Bogotá", "Bogota"],
  VE: ["Venezuelan", "Caracas", "Maduro"], PE: ["Peruvian", "Lima"], CU: ["Cuban", "Havana"], AU: ["Australian", "Canberra", "Sydney", "Melbourne"], NZ: ["New Zealander", "Wellington", "Auckland"],
  ZA: ["South African", "Johannesburg", "Pretoria", "Cape Town"], NG: ["Nigerian", "Abuja", "Lagos"], KE: ["Kenyan", "Nairobi"], ET: ["Ethiopian", "Addis Ababa"],
  SD: ["Sudanese", "Khartoum"], SS: ["South Sudanese", "Juba"], SO: ["Somali", "Mogadishu"], CD: ["Congolese", "Kinshasa"], GH: ["Ghanaian", "Accra"],
  IT: ["Italian", "Rome", "Meloni"], ES: ["Spanish", "Madrid"], PT: ["Portuguese", "Lisbon"], NL: ["Dutch", "Amsterdam", "The Hague"], BE: ["Belgian", "Brussels"],
  CH: ["Swiss", "Geneva", "Zurich"], AT: ["Austrian", "Vienna"], PL: ["Polish", "Warsaw"], SE: ["Swedish", "Stockholm"], NO: ["Norwegian", "Oslo"], FI: ["Finnish", "Helsinki"],
  DK: ["Danish", "Copenhagen"], IE: ["Irish", "Dublin"], GR: ["Greek", "Athens"], HU: ["Hungarian", "Budapest", "Orban"], RO: ["Romanian", "Bucharest"],
  CZ: ["Czech", "Prague"], RS: ["Serbian", "Belgrade"], BY: ["Belarusian", "Minsk"], GE: ["Georgian", "Tbilisi"], AM: ["Armenian", "Yerevan"], AZ: ["Azerbaijani", "Baku"],
  KZ: ["Kazakh", "Astana"], ID: ["Indonesian", "Jakarta"], MY: ["Malaysian", "Kuala Lumpur"], SG: ["Singaporean"], TH: ["Thai", "Bangkok"], VN: ["Vietnamese", "Hanoi"],
  PH: ["Filipino", "Philippine", "Manila"], MM: ["Myanmar's", "Burmese", "Yangon"], TW: ["Taiwanese", "Taipei"], HK: ["Hong Kong"], YE: ["Yemeni", "Houthi", "Houthis", "Sanaa"],
  JO: ["Jordanian", "Amman"], LY: ["Libyan", "Tripoli"], TN: ["Tunisian", "Tunis"], DZ: ["Algerian", "Algiers"], MA: ["Moroccan", "Rabat"], HT: ["Haitian", "Port-au-Prince"],
  VA: ["Vatican", "Pope"], KH: ["Cambodian", "Phnom Penh"], MN: ["Mongolian", "Ulaanbaatar"], UZ: ["Uzbek", "Tashkent"], ZW: ["Zimbabwean", "Harare"], UG: ["Ugandan", "Kampala"],
  TZ: ["Tanzanian", "Dodoma", "Dar es Salaam"], RW: ["Rwandan", "Kigali"], ML: ["Malian", "Bamako"], SN: ["Senegalese", "Dakar"], CM: ["Cameroonian", "Yaoundé"],
};

const geoms = topo50.objects.countries.geometries;
const fc = feature(topo50, topo50.objects.countries);
const coarse = new Set(topo110.objects.countries.geometries.map((g) => g.id).filter(Boolean));

const byCode = new Map();
fc.features.forEach((f, i) => {
  const g = geoms[i];
  const atlasName = g.properties.name;
  const code = g.id ? iso.numericToAlpha2(g.id) : UNCODED[atlasName];
  if (!code) return;
  // Largest polygon gives a centroid on the mainland rather than in the sea between islands.
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  let best = null, bestArea = -1, total = 0;
  for (const p of polys) {
    const poly = { type: "Polygon", coordinates: p };
    const a = geoArea(poly);
    total += a;
    if (a > bestArea) { bestArea = a; best = poly; }
  }
  const [lng, lat] = geoCentroid(best);
  const prev = byCode.get(code);
  const area = (prev?.area || 0) + total;
  if (prev && prev.area >= total) { prev.area = area; return; }
  const name = NAME[code] || iso.getName(code, "en", { select: "alias" }) || atlasName;
  byCode.set(code, {
    code, name, query: QUERY[code] || name,
    lat: +lat.toFixed(2), lng: +lng.toFixed(2), area,
    news: coarse.has(g.id) || EXTRA_NEWS.includes(code) || code === "XK",
    aliases: ALIASES[code] || [],
  });
});

// Hong Kong is folded into China in the atlas; give it its own point.
if (!byCode.has("HK")) byCode.set("HK", { code: "HK", name: "Hong Kong", query: "Hong Kong", lat: 22.32, lng: 114.17, area: 0, news: true, aliases: [] });
if (!byCode.has("SG")) byCode.set("SG", { code: "SG", name: "Singapore", query: "Singapore", lat: 1.35, lng: 103.82, area: 0, news: true, aliases: ["Singaporean"] });

const out = [...byCode.values()]
  .map(({ area, ...c }) => ({ ...c, size: +Math.sqrt(area * 1000).toFixed(2) }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL("../src/data/countries.json", import.meta.url), JSON.stringify(out));
console.log(`${out.length} countries, ${out.filter((c) => c.news).length} with feeds`);
