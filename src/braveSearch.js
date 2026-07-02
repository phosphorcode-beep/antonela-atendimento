import { logger } from "./logger.js";

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export function braveSearchEnabled() {
  return Boolean(process.env.BRAVE_API_KEY);
}

// ── Rate limit simples: plano grátis do Brave é 1 req/s ──────────────────────
let lastCallAt = 0;
async function throttle() {
  const wait = lastCallAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function searchWeb(query, count = 5) {
  if (!braveSearchEnabled()) return [];

  await throttle();
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, query }, "Brave Search retornou erro");
      return [];
    }
    const data = await res.json();
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, description: r.description }));
  } catch (err) {
    logger.error({ err: err.message, query }, "❌ Falha na Brave Search");
    return [];
  }
}

// ── Hosts que não são o site oficial da empresa (redes, diretórios, listas) ──
const NON_OFFICIAL_HOST = /(instagram|facebook|fb\.com|linkedin|twitter|x\.com|youtube|tiktok|wa\.me|whatsapp|google\.|maps\.|goo\.gl|waze|ifood|olx|mercadolivre|mercadolibre|amazon|reclameaqui|guiamais|apontador|telelistas|econodata|cnpj|jusbrasil|wikipedia|glassdoor|indeed|catho|vagas|booking|tripadvisor|yelp)\./i;

// ── Acha o provável site oficial da empresa (pra depois raspar CNPJ/contatos).
// Filtra redes sociais, diretórios e listas — devolve a raiz do primeiro
// domínio "próprio" que aparecer, ou null. Usa 1 chamada Brave ─────────────
export async function findOfficialWebsite({ nome, cidade }) {
  if (!nome || !braveSearchEnabled()) return null;

  const local = cidade ? ` ${cidade}` : "";
  const results = await searchWeb(`${nome}${local} site oficial`, 5);

  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (NON_OFFICIAL_HOST.test(host)) continue;
      if (/\.gov\.br$/i.test(host)) continue;
      return `https://${host}`;
    } catch {
      continue;
    }
  }
  return null;
}

// ── Acha o Instagram/LinkedIn públicos da empresa via dorks ─────────────────
export async function findSocialLinks({ nome, cidade }) {
  if (!nome) return { instagram: null, linkedin: null };

  const local = cidade ? ` "${cidade}"` : "";

  const [igResults, liResults] = await Promise.all([
    searchWeb(`site:instagram.com "${nome}"${local}`, 3),
    searchWeb(`site:linkedin.com/company "${nome}"${local}`, 3),
  ]);

  const instagram = extractInstagramHandle(igResults[0]?.url);
  const linkedin = liResults[0]?.url ?? null;

  return { instagram, linkedin };
}

function extractInstagramHandle(url) {
  if (!url) return null;
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

// ── Heurística de decisor: busca "<empresa> (dono OR sócio OR fundador OR
// diretor OR "gerente comercial")" e tenta extrair um nome próprio do título/
// descrição dos resultados. Só serve como CANDIDATO — a confirmação de
// verdade vem de cruzar esse nome com o QSA (feito em companyIntel.js) ──────
export async function findDecisionMakerMention({ nome }) {
  if (!nome) return null;

  const results = await searchWeb(
    `"${nome}" (dono OR sócio OR fundador OR diretor OR "gerente comercial")`,
    5,
  );

  for (const r of results) {
    const text = `${r.title} ${r.description}`;
    const candidate = extractNameNearRoleKeyword(text);
    if (candidate) return { nome: candidate, fonte: r.url };
  }
  return null;
}

const ROLE_KEYWORDS = /(dono|s[óo]cio|fundador|diretor|gerente comercial)/i;
const NAME_RE = /\b([A-ZÀ-Ý][a-zà-ý]+(?:\s+[A-ZÀ-Ý][a-zà-ý]+){1,3})\b/g;

function extractNameNearRoleKeyword(text) {
  if (!ROLE_KEYWORDS.test(text)) return null;
  const names = [...text.matchAll(NAME_RE)].map((m) => m[1]);
  return names[0] ?? null;
}
