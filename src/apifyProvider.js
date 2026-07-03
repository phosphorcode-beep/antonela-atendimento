import { logger } from "./logger.js";

const APIFY_API_BASE = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "compass/crawler-google-places";

const SEGMENT_SEARCH_TERMS = {
  saude: ["clinica"],
  varejo: ["loja"],
};

export function apifyEnabled() {
  return Boolean(process.env.APIFY_API_TOKEN);
}

function actorPath(actorId) {
  return actorId.replace("/", "~");
}

function searchTermsFor(segment) {
  const custom = process.env.APIFY_SEARCH_TERMS;
  if (custom) {
    return custom
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
  }
  return SEGMENT_SEARCH_TERMS[segment] ?? [segment].filter(Boolean);
}

function firstOf(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).trim() || null;
}

function extractEmail(item) {
  const direct = firstOf(item.email, item.emailAddress, item.contactEmail);
  if (direct) return direct;

  const emails = firstOf(item.emails, item.contactEmails, item.websiteEmails);
  if (Array.isArray(emails)) {
    const value = firstOf(...emails.map((email) => (typeof email === "string" ? email : email?.email)));
    if (value) return value;
  }

  return null;
}

function extractSocial(item, network) {
  const direct = firstOf(item[network], item[`${network}Url`], item[`${network}URL`]);
  if (direct) return direct;

  const links = firstOf(item.socialMediaLinks, item.socials, item.contactSocials);
  if (Array.isArray(links)) {
    const found = links.find((link) => {
      const value = typeof link === "string" ? link : firstOf(link.url, link.link);
      return value && value.toLowerCase().includes(`${network}.com`);
    });
    if (found) return typeof found === "string" ? found : firstOf(found.url, found.link);
  }

  return null;
}

function instagramHandle(value) {
  if (!value) return null;
  const match = String(value).match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/);
  return match ? match[1].replace(/\.$/, "") : String(value).replace(/^@/, "");
}

function mapItem(item, city, uf) {
  const nome = firstOf(item.title, item.name, item.placeName);
  if (!nome) return null;

  const location = item.location ?? {};
  const website = firstOf(item.website, item.url, item.websiteUrl, item.websiteURL);
  const instagram = instagramHandle(extractSocial(item, "instagram"));
  const linkedin = extractSocial(item, "linkedin");

  return {
    nome,
    telefone: normalizePhone(firstOf(item.phone, item.phoneNumber, item.contactPhone, item.internationalPhoneNumber)),
    email: extractEmail(item),
    website: website || null,
    instagram,
    linkedin,
    endereco: firstOf(item.address, item.street, item.fullAddress),
    cidade: firstOf(item.city, item.neighborhood, city),
    uf: firstOf(item.state, item.stateCode, uf),
    lat: firstOf(item.lat, item.latitude, location.lat),
    lon: firstOf(item.lng, item.lon, item.longitude, location.lng),
    source: "apify-google-maps",
  };
}

export async function searchApifyBusinesses({ city, uf, segment, maxResults = 20 }) {
  if (!apifyEnabled()) return [];

  const actorId = process.env.APIFY_GOOGLE_MAPS_ACTOR || DEFAULT_ACTOR;
  const url = new URL(`${APIFY_API_BASE}/acts/${actorPath(actorId)}/run-sync-get-dataset-items`);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("timeout", String(Number(process.env.APIFY_SYNC_TIMEOUT_SECONDS ?? 300)));

  const input = {
    searchStringsArray: searchTermsFor(segment),
    locationQuery: `${city}, ${uf}, Brasil`,
    maxCrawledPlacesPerSearch: Math.max(1, Number(maxResults)),
    language: "pt-BR",
    scrapeContacts: process.env.APIFY_SCRAPE_CONTACTS === "true",
    scrapePlaceDetailPage: process.env.APIFY_SCRAPE_PLACE_DETAIL_PAGE === "true",
    maximumLeadsEnrichmentRecords: 0,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Apify ${res.status}: ${txt.slice(0, 300)}`);
    }

    const items = await res.json();
    const businesses = (Array.isArray(items) ? items : [])
      .map((item) => mapItem(item, city, uf))
      .filter(Boolean)
      .slice(0, maxResults);

    logger.info({ actorId, segment, city, uf, count: businesses.length }, "Leads encontrados via Apify");
    return businesses;
  } catch (err) {
    logger.error({ err, actorId, city, uf, segment }, "Falha ao buscar leads via Apify");
    return [];
  }
}
