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
const NON_OFFICIAL_HOST = /(instagram|facebook|fb\.com|linkedin|twitter|x\.com|youtube|tiktok|wa\.me|whatsapp|google\.|maps\.|goo\.gl|waze|ifood|olx|mercadolivre|mercadolibre|amazon|reclameaqui|guiafacil|guiamais|guia\w*|apontador|telelistas|listafacil|econodata|cnpj|jusbrasil|wikipedia|glassdoor|indeed|catho|vagas|booking|tripadvisor|yelp|doctoralia|boaconsulta|agendarconsulta|encontreseu|solutudo)\./i;

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

// Busca contatos publicos ligados ao nome do decisor. Prioridade:
// perfil pessoal/profissional primeiro; contato empresarial fica como fallback
// em companyIntel.js quando nada pessoal aparecer aqui.
export async function findDecisionMakerContacts({ nome, empresa }) {
  if (!nome || !braveSearchEnabled()) {
    return { email: null, phone: null, whatsapp: null, linkedin: null, instagram: null, sourceUrls: [] };
  }

  const companyHint = empresa ? ` "${empresa}"` : "";
  const queries = [
    `site:linkedin.com/in "${nome}"${companyHint}`,
    `site:instagram.com "${nome}"${companyHint}`,
    `"${nome}"${companyHint} (email OR e-mail OR contato OR whatsapp OR telefone)`,
  ];

  const [liResults, igResults, contactResults] = await Promise.all(queries.map((q) => searchWeb(q, 5)));
  const linkedin = firstPersonalLinkedin(liResults);
  const instagram = firstInstagramHandleForName(igResults, nome);

  let email = null;
  let phone = null;
  let whatsapp = null;
  for (const r of contactResults) {
    const text = `${r.title ?? ""} ${r.description ?? ""} ${r.url ?? ""}`;
    email ||= extractEmail(text);
    const foundPhone = extractPhone(text);
    phone ||= foundPhone;
    whatsapp ||= looksLikeWhatsapp(text) ? foundPhone : null;
    if (email && phone) break;
  }

  const sourceUrls = [...liResults, ...igResults, ...contactResults]
    .map((r) => r.url)
    .filter(Boolean)
    .slice(0, 5);

  return { email, phone, whatsapp, linkedin, instagram, sourceUrls };
}

function extractInstagramHandle(url) {
  if (!url) return null;
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

function firstPersonalLinkedin(results) {
  return results.find((r) => /linkedin\.com\/in\//i.test(r.url ?? ""))?.url ?? null;
}

function firstInstagramHandleForName(results, nome) {
  const expected = normalizeLoose(nome);
  for (const r of results) {
    const handle = extractInstagramHandle(r.url);
    if (!handle) continue;
    const haystack = normalizeLoose(`${r.title ?? ""} ${r.description ?? ""} ${handle}`);
    if (expected.split(" ").some((part) => part.length > 2 && haystack.includes(part))) return handle;
  }
  return null;
}

function normalizeLoose(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmail(text) {
  const match = String(text).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractPhone(text) {
  for (const match of String(text).matchAll(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{4}/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) return digits;
  }
  return null;
}

function looksLikeWhatsapp(text) {
  return /(whats|wa\.me|api\.whatsapp)/i.test(String(text));
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
