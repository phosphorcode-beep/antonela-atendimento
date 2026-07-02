import { logger } from "./logger.js";
import { enrichByCnpj } from "./cnpjProviders.js";
import { geocodeCity, searchBusinesses } from "./discovery.js";
import { upsertCompanyLead } from "./supabase.js";
import { notifyLeadsGroup } from "./notify.js";

const CNPJ_RE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;

// ── Valida dígitos verificadores do CNPJ (rejeita placeholders tipo 00000000000000,
// comuns em máscaras de formulário e frequentemente confundidos com CNPJ real) ──
export function isValidCnpj(digits) {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // todos os dígitos iguais

  const calcDigit = (base, weights) => {
    const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = calcDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

// ── Links do Instagram costumam ter caminhos reservados que não são handles ───
const INSTAGRAM_RESERVED = new Set(["p", "explore", "accounts", "reel", "reels", "stories", "tv", "share", "about", "developer", "legal"]);
const INSTAGRAM_RE = /instagram\.com\/([a-zA-Z0-9_.]{2,30})/gi;

function extractCnpjFromHtml(html) {
  const candidates = html.match(CNPJ_RE) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (isValidCnpj(digits)) return digits;
  }
  return null;
}

function extractInstagramFromHtml(html) {
  for (const match of html.matchAll(INSTAGRAM_RE)) {
    const handle = match[1].replace(/\.$/, "");
    if (!INSTAGRAM_RESERVED.has(handle.toLowerCase())) return handle;
  }
  return null;
}

// ── Busca o HTML do site (usado tanto pro CNPJ quanto pro Instagram) ─────────
export async function fetchSiteHtml(website) {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    logger.debug({ err: err.message, website }, "Não foi possível ler o site");
    return null;
  }
}

// ── Extrai os sinais disponíveis no site: CNPJ (validado) e Instagram ───────
export async function extractSiteSignals(website) {
  const html = await fetchSiteHtml(website);
  if (!html) return { cnpj: null, instagram: null };

  return {
    cnpj: extractCnpjFromHtml(html),
    instagram: extractInstagramFromHtml(html),
  };
}

// ── Prioridade de qualificação pra inferir o decisor provável ─────────────────
const DECISION_PRIORITY = [
  { match: /s[óo]cio.?administrador/i, confidence: 0.85 },
  { match: /administrador/i, confidence: 0.75 },
  { match: /diretor/i, confidence: 0.7 },
  { match: /presidente/i, confidence: 0.65 },
  { match: /titular\s+pessoa\s+f[íi]sica/i, confidence: 0.6 },
  { match: /s[óo]cio/i, confidence: 0.55 },
  { match: /representante\s+legal/i, confidence: 0.5 },
];

export function inferDecisionMaker(qsa) {
  if (!Array.isArray(qsa) || qsa.length === 0) {
    return { nome: null, qualificacao: null, confidence: 0 };
  }

  for (const { match, confidence } of DECISION_PRIORITY) {
    const found = qsa.find((s) => s.qualificacao && match.test(s.qualificacao));
    if (found) return { nome: found.nome, qualificacao: found.qualificacao, confidence };
  }

  const [first] = qsa;
  return { nome: first.nome, qualificacao: first.qualificacao, confidence: 0.3 };
}

// ── Score de oportunidade (0-100) ─────────────────────────────────────────────
export function calculateFitScore(lead, segment) {
  const targetCity = (process.env.PROSPECT_TARGET_CITY || "Brasília").toLowerCase();
  let score = 0;

  if (segment === "saude") score += 25;
  if ((lead.cidade || "").toLowerCase().includes(targetCity)) score += 15;
  if (lead.situacaoAtiva === true || lead.situacaoAtiva === null) score += 10;
  if (lead.nomeFantasia) score += 10;
  if (lead.telefone) score += 10;
  if (lead.email) score += 10;
  if (lead.decisionMakerConfidence >= 0.7) score += 15;
  if (lead.matriz) score += 10;
  if (lead.website) score += 10;

  return Math.min(score, 100);
}

const DOR_HIPOTESE = {
  saude: "agendamento e atendimento ao paciente",
  varejo: "controle de estoque e vendas",
};

function segmentLabel(segment) {
  if (segment === "saude") return "saúde";
  if (segment === "varejo") return "varejo";
  return "sua área de atuação";
}

// ── Mensagem consultiva (template fixo, tom Antonela: sem travessão) ──────────
export function buildOutreachMessage(lead, segment) {
  const nome = lead.decisionMakerName ? lead.decisionMakerName.split(/\s+/)[0] : null;
  const empresa = lead.nomeFantasia || lead.razaoSocial || "sua empresa";
  const cidade = lead.cidade || "sua cidade";
  const dor = DOR_HIPOTESE[segment] || "atendimento e operação";

  const saudacao = nome ? `Olá, ${nome}.` : "Olá.";

  return `${saudacao} Vi que a ${empresa} atua em ${segmentLabel(segment)} em ${cidade}. Pela estrutura pública da empresa e pelo perfil operacional do segmento, parece haver oportunidade de melhorar ${dor}, especialmente em atendimento, agenda, controle interno ou relatórios. A Phosphorcode cria sistemas próprios e integrações pra operações desse tipo. Faz sentido eu mandar 3 ideias objetivas pra esse cenário?`;
}

// ── Monta o lead completo a partir de um negócio (Overpass, ou objeto sintético
// vindo do comando /empresa) + enriquecimento. Se `business.cnpj` já vier
// preenchido (ex: usuário digitou o CNPJ direto), pula a extração pelo site ──
export async function buildLead(business, segment) {
  let cnpj = business.cnpj || null;
  let instagram = null;

  if (business.website) {
    const signals = await extractSiteSignals(business.website);
    cnpj = cnpj || signals.cnpj;
    instagram = signals.instagram;
  }

  let enriched = null;
  if (cnpj) {
    enriched = await enrichByCnpj(cnpj);
  }

  const decisionMaker = inferDecisionMaker(enriched?.qsa);

  const lead = {
    cnpj: cnpj || null,
    razaoSocial: enriched?.razaoSocial || null,
    nomeFantasia: enriched?.nomeFantasia || business.nome,
    telefone: enriched?.telefone || business.telefone || null,
    email: enriched?.email || null,
    website: business.website || null,
    instagram: instagram || null,
    cnaePrincipal: enriched?.cnaePrincipal || null,
    cnaeDescricao: enriched?.cnaeDescricao || null,
    cidade: enriched?.cidade || null,
    uf: enriched?.uf || null,
    endereco: enriched?.endereco || business.endereco || null,
    matriz: enriched?.matriz ?? null,
    situacaoAtiva: enriched?.situacaoAtiva ?? null,
    decisionMakerName: decisionMaker.nome,
    decisionMakerRole: decisionMaker.qualificacao,
    decisionMakerConfidence: decisionMaker.confidence,
    source: enriched?.source || "overpass",
    enrichmentStatus: enriched ? "enriched" : cnpj ? "failed" : "partial",
  };

  lead.fitScore = calculateFitScore(lead, segment);
  lead.suggestedMessage = buildOutreachMessage(lead, segment);
  lead.summary = buildCompanySummary(lead, segment);

  return lead;
}

// ── Processa um negócio encontrado: enriquece, avalia, salva e notifica ──────
export async function processCompany(business, segment) {
  const lead = await buildLead(business, segment);

  const saved = await upsertCompanyLead(lead);
  if (!saved) return null;

  await notifyLeadsGroup(formatLeadCard(lead));
  return saved;
}

// ── Resumo factual da empresa (não é a abordagem de venda, é a "ficha" do lead) ──
export function buildCompanySummary(lead, segment) {
  const empresa = lead.nomeFantasia || lead.razaoSocial || "Empresa não identificada";
  const atividade = lead.cnaeDescricao || segmentLabel(segment);
  const local = [lead.cidade, lead.uf].filter(Boolean).join("/") || "localização não identificada";
  const situacao = lead.situacaoAtiva === true ? "ativa" : lead.situacaoAtiva === false ? "inativa" : "situação não confirmada";

  return `${empresa} atua em ${atividade}, com sede em ${local}. Situação cadastral: ${situacao}.`;
}

// ── Card visual pro grupo (usado tanto na descoberta automática quanto no /empresa) ──
export function formatLeadCard(lead) {
  const divider = "───────────────────";
  const titulo = lead.nomeFantasia || lead.razaoSocial || "Empresa não identificada";

  const lines = [
    `🏢 *${titulo}*`,
    divider,
    `📝 ${lead.summary}`,
    ``,
    `📋 *CNPJ:* ${lead.cnpj || "não identificado (dado parcial)"}`,
    lead.razaoSocial && lead.razaoSocial !== titulo ? `🏛️ *Razão social:* ${lead.razaoSocial}` : null,
    `📍 *Local:* ${[lead.cidade, lead.uf].filter(Boolean).join("/") || "não identificado"}`,
    lead.endereco ? `🗺️ *Endereço:* ${lead.endereco}` : null,
    divider,
    `📱 *Contato:* ${lead.telefone || "não encontrado"}`,
    lead.email ? `✉️ *E-mail:* ${lead.email}` : null,
    lead.website ? `🔗 *Site:* ${lead.website}` : null,
    lead.instagram ? `📸 *Instagram:* @${lead.instagram}` : null,
    divider,
    lead.decisionMakerName
      ? `👤 *Decisor provável:* ${lead.decisionMakerName} — ${lead.decisionMakerRole} (confiança ${Math.round(lead.decisionMakerConfidence * 100)}%)`
      : `👤 *Decisor provável:* não identificado`,
    `⭐ *Score:* ${lead.fitScore}/100 · _status: ${lead.enrichmentStatus}_`,
    divider,
    `💬 *Sugestão de abordagem:*`,
    lead.suggestedMessage,
  ].filter(Boolean);

  return lines.join("\n");
}

// ── Ponto de entrada: geocodifica a cidade, descobre negócios e processa um a um ──
export async function runDiscovery({ city, uf, segment, maxResults = 20 }) {
  logger.info({ city, uf, segment, maxResults }, "🔎 Iniciando descoberta de leads");

  const { boundingbox } = await geocodeCity(city, uf);
  const businesses = await searchBusinesses({ boundingbox, segment, maxResults });

  let processed = 0;
  for (const business of businesses) {
    try {
      const saved = await processCompany(business, segment);
      if (saved) processed += 1;
    } catch (err) {
      logger.error({ err, business: business.nome }, "❌ Falha ao processar negócio");
    }
  }

  logger.info({ found: businesses.length, processed }, "✅ Descoberta de leads concluída");
  return { found: businesses.length, processed };
}
