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

  const igResults = await searchWeb(`site:instagram.com "${nome}"${local}`, 3);
  const liResults = await searchWeb(`site:linkedin.com/company "${nome}"${local}`, 3);

  const instagram = extractInstagramHandle(igResults[0]?.url);
  const linkedin = liResults[0]?.url ?? null;

  return { instagram, linkedin };
}

// Busca contatos publicos ligados ao nome do decisor em camadas:
// 1) perfis pessoais, 2) site oficial citando o nome, 3) snippets publicos,
// 4) diretorios/menções profissionais. Nada aqui chuta e-mail provável.
export async function findDecisionMakerContacts({ nome, empresa, website, cidade, role }) {
  if (!nome || !braveSearchEnabled()) {
    return { email: null, phone: null, whatsapp: null, linkedin: null, instagram: null, sourceUrls: [], layers: [] };
  }

  const companyHint = empresa ? ` "${empresa}"` : "";
  const cityHint = cidade ? ` "${cidade}"` : "";
  const roleHint = role ? ` "${role}"` : "";
  const found = {
    email: null,
    phone: null,
    whatsapp: null,
    linkedin: null,
    instagram: null,
    sourceUrls: [],
    layers: [],
  };

  const addSource = (url, layer) => {
    if (!url) return;
    if (!found.sourceUrls.includes(url)) found.sourceUrls.push(url);
    if (layer && !found.layers.includes(layer)) found.layers.push(layer);
  };

  const absorbText = (text, url, layer, { requireName = true } = {}) => {
    if (requireName && !textMentionsName(text, nome)) return;
    const email = extractEmail(text);
    const phone = extractPhone(text);
    if (email && !found.email) {
      found.email = email;
      addSource(url, layer);
    }
    if (phone && !found.phone) {
      found.phone = phone;
      addSource(url, layer);
    }
    if (phone && looksLikeWhatsapp(text) && !found.whatsapp) {
      found.whatsapp = phone;
      addSource(url, layer);
    }
  };

  const profileQueries = [
    `site:linkedin.com/in "${nome}"${companyHint}${roleHint}`,
    `site:instagram.com "${nome}"${companyHint}`,
    `site:facebook.com "${nome}"${companyHint}`,
  ];
  const profileResults = await searchMany(profileQueries, 5);
  found.linkedin = firstPersonalLinkedin(profileResults);
  found.instagram = firstInstagramHandleForName(profileResults, nome);
  if (found.linkedin) addSource(found.linkedin, "perfil-pessoal-linkedin");
  if (found.instagram) addSource(`https://instagram.com/${found.instagram}`, "perfil-pessoal-instagram");

  const officialPages = await findOfficialPagesMentioningPerson({ nome, empresa, website });
  for (const page of officialPages) {
    absorbText(page.text, page.url, "site-oficial-com-nome");
    if (found.email && found.phone) break;
  }

  const contactQueries = [
    `"${nome}"${companyHint} (email OR e-mail OR contato OR telefone OR whatsapp)`,
    `"${nome}"${companyHint}${cityHint} ("@gmail.com" OR "@hotmail.com" OR "@outlook.com" OR "@icloud.com")`,
    `"${nome}"${companyHint} (celular OR WhatsApp OR "fale com")`,
    `"${nome}"${companyHint}${roleHint} (LinkedIn OR Instagram OR contato)`,
  ];
  const contactResults = await searchMany(contactQueries, 5);
  for (const r of contactResults) {
    const text = `${r.title ?? ""} ${r.description ?? ""} ${r.url ?? ""}`;
    absorbText(text, r.url, "snippet-publico");
    if (!found.linkedin && /linkedin\.com\/in\//i.test(r.url ?? "")) {
      found.linkedin = r.url;
      addSource(r.url, "snippet-linkedin");
    }
    if (!found.instagram) {
      const handle = firstInstagramHandleForName([r], nome);
      if (handle) {
        found.instagram = handle;
        addSource(r.url, "snippet-instagram");
      }
    }
    if (found.email && found.phone && found.linkedin && found.instagram) break;
  }

  found.sourceUrls = found.sourceUrls.slice(0, 8);
  return found;
}

const OFFICIAL_PERSON_PATHS = [
  "/",
  "/sobre",
  "/sobre-nos",
  "/quem-somos",
  "/time",
  "/equipe",
  "/diretoria",
  "/lideranca",
  "/contato",
];

async function findOfficialPagesMentioningPerson({ nome, empresa, website }) {
  const pages = [];
  const base = normalizeWebsiteBase(website);

  if (base) {
    for (const path of OFFICIAL_PERSON_PATHS) {
      const url = `${base}${path}`;
      const text = await fetchPublicText(url);
      if (text && textMentionsName(text, nome)) pages.push({ url, text });
      if (pages.length >= 3) break;
    }
  }

  if (pages.length >= 3 || !empresa) return pages;

  const host = base ? new URL(base).hostname.replace(/^www\./, "") : null;
  const siteQuery = host
    ? `site:${host} "${nome}" ("email" OR "telefone" OR "whatsapp" OR "diretoria" OR "equipe")`
    : `"${empresa}" "${nome}" ("diretoria" OR "equipe" OR "contato")`;
  const results = await searchWeb(siteQuery, 5);

  for (const r of results) {
    const text = `${r.title ?? ""} ${r.description ?? ""}`;
    if (textMentionsName(text, nome)) pages.push({ url: r.url, text: `${text} ${r.url ?? ""}` });
    if (pages.length >= 5) break;
  }

  return pages;
}

async function fetchPublicText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 50000);
  } catch {
    return null;
  }
}

async function searchMany(queries, count = 5) {
  const results = [];
  for (const query of queries) {
    results.push(...(await searchWeb(query, count)));
  }
  return results;
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

function normalizeWebsiteBase(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

function textMentionsName(text, nome) {
  const haystack = normalizeLoose(text);
  const words = normalizeLoose(nome).split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  if (words.length === 1) return haystack.includes(words[0]);

  const first = words[0];
  const last = words[words.length - 1];
  return haystack.includes(`${first} ${last}`) || (haystack.includes(first) && haystack.includes(last));
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

  const queries = [
    `"${nome}" (dono OR sócio OR fundador OR diretor OR "gerente comercial")`,
    `"${nome}" ("CEO" OR "CFO" OR "COO" OR "head" OR "proprietário" OR "administrador")`,
    `"${nome}" ("sócia" OR "fundadora" OR "diretora" OR "proprietária")`,
    `site:linkedin.com/in "${nome}" (fundador OR diretor OR CEO OR sócio OR proprietário)`,
  ];
  const results = await searchMany(queries, 5);

  for (const r of results) {
    const text = `${r.title} ${r.description}`;
    const candidate = extractNameNearRoleKeyword(text);
    if (candidate) return { nome: candidate, fonte: r.url };
  }
  return null;
}

const ROLE_KEYWORDS = /(dono|s[óo]ci[oa]|fundador[ao]?|diretor[ao]?|gerente comercial|CEO|CFO|COO|head|propriet[áa]ri[oa]|administrador[ao]?)/i;
const NAME_RE = /\b([A-ZÀ-Ý][a-zà-ý]+(?:\s+[A-ZÀ-Ý][a-zà-ý]+){1,3})\b/g;

function extractNameNearRoleKeyword(text) {
  if (!ROLE_KEYWORDS.test(text)) return null;
  const names = [...text.matchAll(NAME_RE)].map((m) => m[1]);
  return names[0] ?? null;
}
