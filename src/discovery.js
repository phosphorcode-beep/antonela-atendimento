import { logger } from "./logger.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function userAgent() {
  const contact = process.env.PROSPECT_CONTACT_EMAIL || "contato@phosphorcode.com.br";
  return `AntonelaProspecting/1.0 (${contact})`;
}

// ── Tags OSM por segmento ──────────────────────────────────────────────────────
const SEGMENT_TAGS = {
  saude: [
    ["amenity", "clinic"],
    ["amenity", "doctors"],
    ["amenity", "dentist"],
    ["amenity", "hospital"],
    ["amenity", "pharmacy"],
    ["healthcare", "*"],
  ],
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

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "*/*", "User-Agent": userAgent() },
    body: query,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);

  const data = await res.json();
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

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "*/*", "User-Agent": userAgent() },
    body: query,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);

  const data = await res.json();
  const businesses = mapOverpassElements(data.elements ?? [], maxResults);

  logger.info({ name, city, uf, count: businesses.length }, "🗺️  Busca por nome no Overpass (restrita à cidade-alvo)");
  return businesses;
}
