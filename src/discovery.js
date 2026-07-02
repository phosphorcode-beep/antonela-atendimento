import { logger } from "./logger.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function userAgent() {
  const contact = process.env.PROSPECT_CONTACT_EMAIL || "contato@phosphorcode.com.br";
  return `AntonelaProspecting/1.0 (${contact})`;
}

// ── Pacing pras APIs públicas (Overpass/Nominatim throttlam agressivo em rodada
// nacional). Espaça as chamadas e tenta de novo com backoff em 429/5xx ──────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastOverpassAt = 0;
let lastNominatimAt = 0;

async function pace(ref, minMs) {
  const wait = ref.at + minMs - Date.now();
  if (wait > 0) await sleep(wait);
  ref.at = Date.now();
}
const overpassRef = { get at() { return lastOverpassAt; }, set at(v) { lastOverpassAt = v; } };
const nominatimRef = { get at() { return lastNominatimAt; }, set at(v) { lastNominatimAt = v; } };

async function overpassPost(query, { retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pace(overpassRef, 2500);
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "*/*", "User-Agent": userAgent() },
      body: query,
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(attempt * 4000); // backoff: 4s, 8s
      continue;
    }
    throw new Error(`Overpass ${res.status}`);
  }
}

// ── Tags OSM por segmento ──────────────────────────────────────────────────────
const CLINICAS_TAGS = [
  ["amenity", "clinic"],
  ["amenity", "doctors"],
  ["amenity", "dentist"],
  ["amenity", "hospital"],
  ["amenity", "pharmacy"],
  ["healthcare", "*"],
  ["shop", "beauty"],
];

const SEGMENT_TAGS = {
  industria: [
    ["industrial", "*"],
    ["man_made", "works"],
    ["building", "industrial"],
    ["landuse", "industrial"],
  ],
  distribuidora: [
    ["shop", "wholesale"],
    ["shop", "trade"],
    ["building", "warehouse"],
    ["industrial", "warehouse"],
    ["office", "logistics"],
  ],
  servicos_campo: [
    ["craft", "electrician"],
    ["craft", "plumber"],
    ["craft", "hvac"],
    ["craft", "carpenter"],
    ["craft", "roofer"],
    ["shop", "doityourself"],
  ],
  clinicas: CLINICAS_TAGS,
  franquias: [
    ["shop", "*"],
    ["amenity", "restaurant"],
    ["amenity", "fast_food"],
    ["amenity", "cafe"],
    ["leisure", "fitness_centre"],
  ],
  agro: [
    ["shop", "agrarian"],
    ["shop", "farm"],
    ["industrial", "food"],
    ["craft", "winery"],
    ["man_made", "silo"],
  ],
  saude: CLINICAS_TAGS,
  varejo: [
    ["shop", "*"],
  ],
};

// ── Geocodifica a cidade pra um bounding box (Nominatim, respeita 1 req/s) ────
export async function geocodeCity(city, uf) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", `${city}, ${uf}, Brasil`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  await pace(nominatimRef, 1200);
  const res = await fetch(url, { headers: { "User-Agent": userAgent() } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);

  const [place] = await res.json();
  if (!place) throw new Error(`Cidade não encontrada: ${city}, ${uf}`);

  return {
    boundingbox: place.boundingbox.map(Number), // [south, north, west, east]
  };
}

// ── Busca negócios na área via Overpass, conforme tags do segmento ───────────
export async function searchBusinesses({ boundingbox, segment, maxResults = 20 }) {
  const tags = SEGMENT_TAGS[segment];
  if (!tags) throw new Error(`Segmento desconhecido: ${segment}`);

  const [south, north, west, east] = boundingbox;
  const bbox = `${south},${west},${north},${east}`;

  const clauses = tags
    .map(([k, v]) => (v === "*" ? `node["${k}"](${bbox});way["${k}"](${bbox});` : `node["${k}"="${v}"](${bbox});way["${k}"="${v}"](${bbox});`))
    .join("\n");

  const query = `[out:json][timeout:25];(${clauses});out center ${maxResults};`;

  const data = await overpassPost(query);
  const businesses = mapOverpassElements(data.elements ?? [], maxResults);

  logger.info({ segment, count: businesses.length }, "🗺️  Negócios encontrados via Overpass");
  return businesses;
}

function mapOverpassElements(elements, maxResults) {
  return elements
    .slice(0, maxResults)
    .map((el) => {
      const t = el.tags ?? {};
      const nome = t.name;
      if (!nome) return null;
      return {
        nome,
        telefone: t.phone || t["contact:phone"] || null,
        website: t.website || t["contact:website"] || null,
        endereco: [t["addr:street"], t["addr:housenumber"], t["addr:suburb"]].filter(Boolean).join(", ") || null,
        lat: el.lat ?? el.center?.lat ?? null,
        lon: el.lon ?? el.center?.lon ?? null,
        source: "overpass",
      };
    })
    .filter(Boolean);
}

// ── Busca best-effort por nome, restrita à cidade-alvo (busca nacional é lenta
// demais pro Overpass público — testado e deu timeout acima de 60s) ──────────
export async function searchByName(name, { maxResults = 5 } = {}) {
  const city = process.env.PROSPECT_TARGET_CITY || "Brasília";
  const uf = process.env.PROSPECT_TARGET_UF || "DF";
  const { boundingbox } = await geocodeCity(city, uf);
  const [south, north, west, east] = boundingbox;
  const bbox = `${south},${west},${north},${east}`;

  const escaped = name.replace(/["\\]/g, "");
  const query = `[out:json][timeout:25];(node["name"~"${escaped}",i](${bbox});way["name"~"${escaped}",i](${bbox}););out center ${maxResults};`;

  const data = await overpassPost(query);
  const businesses = mapOverpassElements(data.elements ?? [], maxResults);

  logger.info({ name, city, uf, count: businesses.length }, "🗺️  Busca por nome no Overpass (restrita à cidade-alvo)");
  return businesses;
}
