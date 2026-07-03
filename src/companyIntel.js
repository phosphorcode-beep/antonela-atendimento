import { logger } from "./logger.js";
import { enrichByCnpj } from "./cnpjProviders.js";
import { geocodeCity, searchBusinesses } from "./discovery.js";
import { brasilioEnabled, searchByCnae } from "./brasilioProvider.js";
import { apifyEnabled, searchApifyBusinesses } from "./apifyProvider.js";
import { braveSearchEnabled, findOfficialWebsite, findSocialLinks, findDecisionMakerMention, findDecisionMakerContacts } from "./braveSearch.js";
import { computeConfidence, computeTier } from "./confidence.js";
import { getNicheProfile } from "./niches.js";
import { classifyPorte, evaluateSize } from "./sizing.js";
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

// ── E-mail: prioriza mailto:, cai pra regex no corpo. Descarta lixo comum de
// front-end (imagens @2x, sentry, wixpress, exemplos) que casa com o padrão ──
const EMAIL_JUNK_RE = /(sentry|wixpress|example|@2x|\.png|\.jpg|\.svg|\.gif|\.webp|domain\.com|email\.com|seuemail|your-?email)/i;
function extractEmailFromHtml(html) {
  const mailto = html.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (mailto && !EMAIL_JUNK_RE.test(mailto[1])) return mailto[1].toLowerCase();

  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    if (!EMAIL_JUNK_RE.test(m[0])) return m[0].toLowerCase();
  }
  return null;
}

// ── WhatsApp: links wa.me / api.whatsapp.com. Valida DDD+número BR (10-13 díg). ─
function extractWhatsappFromHtml(html) {
  const m = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d{10,13})/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

// ── Telefone: link tel:. Só dígitos, exige tamanho plausível de fixo/celular BR ─
function extractPhoneFromHtml(html) {
  for (const m of html.matchAll(/tel:(\+?[\d\s().-]{8,20})/gi)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 13) return digits;
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

// Páginas onde CNPJ costuma aparecer quando não está na home (LGPD obriga
// política de privacidade, e ela quase sempre lista a razão social/CNPJ) ─────
const CNPJ_FALLBACK_PATHS = ["/politica-de-privacidade", "/termos-de-uso"];

// ── Extrai os sinais disponíveis no site: CNPJ (validado), Instagram e contatos
// (e-mail, telefone, WhatsApp). Os contatos ajudam a acionar leads que só têm
// site, sem depender de enriquecimento por CNPJ ────────────────────────────
export async function extractSiteSignals(website) {
  const homeHtml = await fetchSiteHtml(website);
  if (!homeHtml) return { cnpj: null, instagram: null, email: null, telefone: null, whatsapp: null };

  const instagram = extractInstagramFromHtml(homeHtml);
  const email = extractEmailFromHtml(homeHtml);
  const whatsapp = extractWhatsappFromHtml(homeHtml);
  const telefone = extractPhoneFromHtml(homeHtml) || whatsapp;
  let cnpj = extractCnpjFromHtml(homeHtml);

  if (!cnpj) {
    const base = website.replace(/\/$/, "");
    for (const path of CNPJ_FALLBACK_PATHS) {
      const html = await fetchSiteHtml(`${base}${path}`);
      if (!html) continue;
      cnpj = extractCnpjFromHtml(html);
      if (cnpj) break;
    }
  }

  return { cnpj, instagram, email, telefone, whatsapp };
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
  const profile = getNicheProfile(segment);
  let score = 0;

  if (profile) score += profile.priority <= 2 ? 30 : 25;
  if ((lead.cidade || "").toLowerCase().includes(targetCity)) score += 15;
  if (lead.situacaoAtiva === true || lead.situacaoAtiva === null) score += 10;
  if (lead.nomeFantasia) score += 10;
  if (lead.telefone) score += 10;
  if (lead.email) score += 10;
  if (lead.decisionMakerPhone || lead.decisionMakerWhatsapp) score += 20;
  if (lead.decisionMakerEmail) score += 15;
  if (lead.decisionMakerLinkedin || lead.decisionMakerInstagram) score += 10;
  if (lead.decisionMakerConfidence >= 0.7) score += 15;
  if (lead.matriz) score += 10;
  if (lead.website) score += 10;
  // Porte confirmado dentro do alvo (PME/MEI) é sinal forte de fit comercial.
  if (lead.sizeKnown && lead.sizeIsTarget) score += 15;

  return Math.min(score, 100);
}

function segmentLabel(segment) {
  const profile = getNicheProfile(segment);
  if (profile) return profile.label;
  return "sua área de atuação";
}

// ── Mensagem consultiva (template fixo, tom Antonela: sem travessão). Retorna
// null quando não há nem nome de empresa nem cidade conhecidos — nesse caso não
// dá pra escrever uma abordagem que faça sentido, só dados soltos (site/insta) ──
export function buildOutreachMessage(lead, segment) {
  if (!lead.nomeFantasia && !lead.razaoSocial) return null;

  const nome = lead.decisionMakerName ? lead.decisionMakerName.split(/\s+/)[0] : null;
  const empresa = lead.nomeFantasia || lead.razaoSocial;
  const local = lead.cidade ? ` em ${lead.cidade}` : "";
  const profile = getNicheProfile(segment);
  const dor = profile?.outreachPain || "operação, controle e rastreabilidade";

  const saudacao = nome ? `Olá, ${nome}.` : "Olá.";

  return `${saudacao} Vi a ${empresa}${local}. Pode haver espaço para ganhar controle em ${dor}. A Phosphorcode cria sistemas sob medida para empresas que cresceram mais rápido que os processos. Posso te mandar uma ideia rápida?`;
}

// ── Compara dois nomes de forma tolerante (case/acento/ordem de palavras) pra
// cruzar o decisor achado via QSA com o que a busca web encontrou ───────────
function normalizeName(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas diacríticas combinantes)
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function namesLikelyMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  const wordsA = new Set(na.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = nb.split(/\s+/).filter((w) => w.length > 2);
  return wordsB.some((w) => wordsA.has(w));
}

// ── Monta o lead completo a partir de um negócio (Overpass/brasil.io, ou
// objeto sintético vindo do comando /empresa) + enriquecimento. Se
// `business.cnpj` já vier preenchido, pula a extração pelo site. Acumula
// `fontes` (de onde cada dado veio) e `lacunas` (o que não foi encontrado) ──
export async function buildLead(business, segment) {
  const fontes = [business.source].filter(Boolean);
  const lacunas = [];

  let cnpj = business.cnpj || null;
  let website = business.website || null;
  let instagram = business.instagram || null;
  let siteEmail = null;
  let siteTelefone = null;
  let siteWhatsapp = null;

  // Sem site nem CNPJ: tenta descobrir o site oficial via Brave. É o que
  // destrava o CNPJ (e daí porte/decisor) pra leads que só vieram do Overpass.
  if (!website && !cnpj && braveSearchEnabled() && business.nome) {
    website = await findOfficialWebsite({ nome: business.nome, cidade: business.cidade });
    if (website) fontes.push("brave-site");
  }

  if (website) {
    const signals = await extractSiteSignals(website);
    cnpj = cnpj || signals.cnpj;
    instagram = instagram || signals.instagram;
    siteEmail = signals.email;
    siteTelefone = signals.telefone;
    siteWhatsapp = signals.whatsapp;
    if (siteEmail || siteTelefone || siteWhatsapp) fontes.push("site");
  }

  let enriched = null;
  if (cnpj) {
    enriched = await enrichByCnpj(cnpj);
    if (enriched) fontes.push(enriched.source);
    else lacunas.push("CNPJ encontrado, mas nenhum provider retornou dados");
  } else {
    lacunas.push("CNPJ não encontrado");
  }

  const decisionMaker = inferDecisionMaker(enriched?.qsa);
  if (decisionMaker.nome) fontes.push("qsa");

  const nomeEmpresa = enriched?.nomeFantasia || enriched?.razaoSocial || business.nome || business.razaoSocial;
  let linkedin = business.linkedin || null;
  let decisionMakerEmail = null;
  let decisionMakerPhone = null;
  let decisionMakerWhatsapp = null;
  let decisionMakerLinkedin = null;
  let decisionMakerInstagram = null;
  let decisionMakerContactSources = [];

  // ── Busca web (opcional): Instagram/LinkedIn e cross-validação do decisor ──
  if (braveSearchEnabled() && nomeEmpresa) {
    const cidadeBusca = enriched?.cidade || business.cidade || null;
    const social = await findSocialLinks({ nome: nomeEmpresa, cidade: cidadeBusca });

    if (social.instagram && !instagram) {
      instagram = social.instagram;
      fontes.push("brave-instagram");
    }
    if (social.linkedin && !linkedin) {
      linkedin = social.linkedin;
      fontes.push("brave-linkedin");
    }

    const mention = await findDecisionMakerMention({ nome: nomeEmpresa });
    if (mention?.nome) {
      if (decisionMaker.nome && namesLikelyMatch(decisionMaker.nome, mention.nome)) {
        // Mesmo nome confirmado em 2 fontes independentes (QSA + busca web)
        fontes.push("brave-decisor");
      } else if (!decisionMaker.nome) {
        // Só a busca web achou um candidato, sem QSA pra confirmar
        decisionMaker.nome = mention.nome;
        decisionMaker.qualificacao = "mencionado publicamente";
        decisionMaker.confidence = 0.4;
        fontes.push("brave-decisor");
      }
    }

    if (decisionMaker.nome) {
      const contacts = await findDecisionMakerContacts({ nome: decisionMaker.nome, empresa: nomeEmpresa });
      decisionMakerEmail = contacts.email;
      decisionMakerPhone = contacts.phone;
      decisionMakerWhatsapp = contacts.whatsapp;
      decisionMakerLinkedin = contacts.linkedin;
      decisionMakerInstagram = contacts.instagram;
      decisionMakerContactSources = contacts.sourceUrls ?? [];
      if (decisionMakerEmail || decisionMakerPhone || decisionMakerLinkedin || decisionMakerInstagram) {
        fontes.push("brave-decisor-contato");
      }
    }
  }

  if (!decisionMaker.nome) lacunas.push("decisor não confirmado");

  // ── Porte/tamanho: só é conhecido quando há dado de CNPJ (enriquecimento ou
  // brasil.io). Usado pra filtrar empresas grandes (foco em PME/MEI) ─────────
  const porte = classifyPorte({
    code: enriched?.porteCode ?? business.porteCode,
    text: enriched?.porteText,
    mei: enriched?.mei,
  });
  const capitalSocial = enriched?.capitalSocial ?? business.capitalSocial ?? null;
  const size = evaluateSize({ porte, capitalSocial });

  const lead = {
    segment,
    cnpj: cnpj || null,
    razaoSocial: enriched?.razaoSocial || business.razaoSocial || null,
    nomeFantasia: enriched?.nomeFantasia || business.nome || null,
    telefone: enriched?.telefone || business.telefone || siteTelefone || null,
    whatsapp: enriched?.telefone || business.telefone || siteWhatsapp || siteTelefone || null,
    email: enriched?.email || business.email || siteEmail || null,
    website: website || null,
    instagram: instagram || null,
    linkedin: linkedin || null,
    cnaePrincipal: enriched?.cnaePrincipal || business.cnaePrincipal || null,
    cnaeDescricao: enriched?.cnaeDescricao || business.cnaeDescricao || null,
    cidade: enriched?.cidade || business.cidade || null,
    uf: enriched?.uf || business.uf || null,
    endereco: enriched?.endereco || business.endereco || null,
    matriz: enriched?.matriz ?? null,
    porte: porte || null,
    capitalSocial: capitalSocial ?? null,
    sizeKnown: size.known,
    sizeIsTarget: size.isTarget,
    sizeReason: size.reason,
    situacaoAtiva: enriched?.situacaoAtiva ?? business.situacaoAtiva ?? null,
    decisionMakerName: decisionMaker.nome,
    decisionMakerRole: decisionMaker.qualificacao,
    decisionMakerConfidence: decisionMaker.confidence,
    decisionMakerEmail,
    decisionMakerPhone,
    decisionMakerWhatsapp,
    decisionMakerLinkedin,
    decisionMakerInstagram,
    decisionMakerContactSources,
    source: fontes[0] ?? "unknown",
    fontes,
    enrichmentStatus: enriched ? "enriched" : cnpj ? "failed" : "partial",
  };

  if (!lead.decisionMakerPhone && !lead.decisionMakerWhatsapp && !lead.decisionMakerEmail && !lead.decisionMakerLinkedin && !lead.decisionMakerInstagram) {
    lacunas.push("contato pessoal do decisor nao encontrado");
  }
  if (!lead.telefone) lacunas.push("telefone empresarial nao encontrado");
  if (!lead.email) lacunas.push("email empresarial nao encontrado");
  if (!size.known) lacunas.push("porte não confirmado");
  lead.lacunas = lacunas;

  lead.fitScore = calculateFitScore(lead, segment);
  lead.suggestedMessage = buildOutreachMessage(lead, segment);
  lead.summary = buildCompanySummary(lead, segment);
  lead.confianca = computeConfidence(lead);
  lead.tier = computeTier(lead, lead.confianca);

  return lead;
}

// ── Saída no schema estruturado pedido (JSON, pra log/consumo por outro sistema
// depois — o card do WhatsApp continua sendo a versão humana) ───────────────
export function toStructuredOutput(lead) {
  const profile = getNicheProfile(lead.segment);
  return {
    nicho: profile?.label ?? null,
    empresa: lead.nomeFantasia || lead.razaoSocial || null,
    cnpj: lead.cnpj,
    site: lead.website,
    telefone: lead.telefone,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram,
    linkedin: lead.linkedin,
    decisor_nome: lead.decisionMakerName,
    decisor_cargo: lead.decisionMakerRole,
    decisor_email: lead.decisionMakerEmail,
    decisor_telefone: lead.decisionMakerPhone,
    decisor_whatsapp: lead.decisionMakerWhatsapp,
    decisor_linkedin: lead.decisionMakerLinkedin,
    decisor_instagram: lead.decisionMakerInstagram,
    decisor_fontes_contato: lead.decisionMakerContactSources,
    porte: lead.porte,
    capital_social: lead.capitalSocial,
    fontes: lead.fontes,
    confianca: lead.confianca,
    tier: lead.tier,
    lacunas: lead.lacunas,
    dor_principal: profile?.pain ?? null,
    oferta: profile?.offer ?? null,
  };
}

// ── Processa um negócio encontrado: enriquece, avalia, salva e notifica ──────
export async function processCompany(business, segment) {
  const lead = await buildLead(business, segment);
  logger.info(toStructuredOutput(lead), "📊 Lead processado");

  // Filtro de tamanho: descarta empresa grande (foco em PME/MEI). Só filtra
  // quando o porte é conhecido — sem dado, o lead segue e fica sinalizado.
  if (lead.sizeKnown && !lead.sizeIsTarget) {
    logger.info(
      { empresa: lead.nomeFantasia || lead.razaoSocial, porte: lead.porte, capital: lead.capitalSocial },
      "⏭️  Lead descartado (empresa grande, fora do alvo PME/MEI)",
    );
    return { lead, saved: null, filtered: true };
  }

  const saved = await upsertCompanyLead(lead);
  if (saved) await notifyLeadsGroup(formatLeadCard(lead));

  return { lead, saved, filtered: false };
}

// ── Dedup entre fontes de descoberta (Overpass + brasil.io): por CNPJ quando
// existe, senão por nome normalizado (case/acento/espaço não contam) ────────
function dedupCandidates(businesses) {
  const seen = new Set();
  const result = [];

  for (const b of businesses) {
    const key = b.cnpj ? `cnpj:${b.cnpj}` : `nome:${normalizeName(b.nome)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(b);
  }

  return result;
}

function buildRoundSummary(leads, filtered = 0) {
  const byTier = { A: 0, B: 0, C: 0 };
  const lacunaCounts = new Map();
  let comDecisor = 0;

  for (const lead of leads) {
    byTier[lead.tier] = (byTier[lead.tier] ?? 0) + 1;
    if (lead.decisionMakerName) comDecisor += 1;
    for (const l of lead.lacunas ?? []) {
      lacunaCounts.set(l, (lacunaCounts.get(l) ?? 0) + 1);
    }
  }

  const topLacunas = [...lacunaCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([texto, n]) => `${texto} (${n}x)`);

  const linhas = [
    `📊 *Resumo da rodada*`,
    `Tier A: ${byTier.A} · Tier B: ${byTier.B} · Tier C: ${byTier.C}`,
    `Decisor confirmado: ${comDecisor}/${leads.length}`,
    filtered ? `Descartadas por porte (grandes): ${filtered}` : null,
    topLacunas.length ? `Maiores lacunas: ${topLacunas.join(", ")}` : null,
  ].filter(Boolean);

  return linhas.join("\n");
}

function domainFallback(website) {
  if (!website) return null;
  return website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

// ── Resumo factual da empresa (não é a abordagem de venda, é a "ficha" do lead).
// Quando não há nome de empresa nem CNPJ, evita forçar frase tipo "a sabin.com.br
// atua em..." — em vez disso, diz honestamente o que foi (e não foi) encontrado ──
export function buildCompanySummary(lead, segment) {
  if (!lead.nomeFantasia && !lead.razaoSocial) {
    const achados = [
      lead.website ? `site ${lead.website}` : null,
      lead.instagram ? `Instagram @${lead.instagram}` : null,
    ].filter(Boolean);
    return achados.length
      ? `Não encontrei CNPJ nem razão social públicos para essa empresa. Só achei: ${achados.join(" e ")}.`
      : `Não encontrei nenhum dado público confiável para essa consulta.`;
  }

  const empresa = lead.nomeFantasia || lead.razaoSocial;
  const atividade = lead.cnaeDescricao || segmentLabel(segment);
  const local = [lead.cidade, lead.uf].filter(Boolean).join("/") || "localização não identificada";
  const situacao = lead.situacaoAtiva === true ? "ativa" : lead.situacaoAtiva === false ? "inativa" : "situação não confirmada";

  return `${empresa} atua em ${atividade}, com sede em ${local}. Situação cadastral: ${situacao}.`;
}

// ── Card visual pro grupo (usado tanto na descoberta automática quanto no /empresa).
// Cada seção só aparece se tiver pelo menos um dado real — nada de "não identificado"
// poluindo o card quando a informação simplesmente não existe ──────────────────
const PORTE_LABEL = { MEI: "MEI", ME: "Microempresa", EPP: "Pequeno porte", DEMAIS: "Médio/grande" };

export function formatLeadCard(lead) {
  const divider = "───────────────────";
  const titulo = lead.nomeFantasia || lead.razaoSocial || domainFallback(lead.website) || "Empresa não identificada";
  const local = [lead.cidade, lead.uf].filter(Boolean).join("/");
  const profile = getNicheProfile(lead.segment);
  const hasDecisionMakerContact = Boolean(
    lead.decisionMakerPhone ||
      lead.decisionMakerWhatsapp ||
      lead.decisionMakerEmail ||
      lead.decisionMakerLinkedin ||
      lead.decisionMakerInstagram,
  );

  const sections = [];

  sections.push([`🏢 *${titulo}*`, `📝 ${lead.summary}`]);

  if (profile) {
    sections.push([
      `🎯 *Dor provável:* ${profile.pain}`,
      `🧩 *Oferta:* ${profile.offer}`,
    ]);
  }

  sections.push(
    [
      lead.cnpj ? `📋 *CNPJ:* ${lead.cnpj}` : null,
      lead.razaoSocial && lead.razaoSocial !== titulo ? `🏛️ *Razão social:* ${lead.razaoSocial}` : null,
      lead.porte ? `🏷️ *Porte:* ${PORTE_LABEL[lead.porte] || lead.porte}` : null,
      local ? `📍 *Local:* ${local}` : null,
      lead.endereco ? `🗺️ *Endereço:* ${lead.endereco}` : null,
    ].filter(Boolean),
  );

  sections.push(
    [
      lead.decisionMakerPhone || lead.decisionMakerWhatsapp ? `📱 *Contato do decisor:* ${lead.decisionMakerWhatsapp || lead.decisionMakerPhone}` : null,
      lead.decisionMakerEmail ? `✉️ *E-mail do decisor:* ${lead.decisionMakerEmail}` : null,
      lead.decisionMakerLinkedin ? `💼 *LinkedIn do decisor:* ${lead.decisionMakerLinkedin}` : null,
      lead.decisionMakerInstagram ? `📸 *Instagram do decisor:* @${lead.decisionMakerInstagram}` : null,
      lead.telefone && !hasDecisionMakerContact ? `📱 *Fallback empresarial:* ${lead.telefone}` : null,
      lead.email && !hasDecisionMakerContact ? `✉️ *E-mail empresarial:* ${lead.email}` : null,
      lead.website && !hasDecisionMakerContact ? `🔗 *Site:* ${lead.website}` : null,
      lead.instagram && !hasDecisionMakerContact ? `📸 *Instagram empresarial:* @${lead.instagram}` : null,
      lead.linkedin && !hasDecisionMakerContact ? `💼 *LinkedIn empresarial:* ${lead.linkedin}` : null,
    ].filter(Boolean),
  );

  sections.push(
    [
      lead.decisionMakerName
        ? `👤 *Decisor provável:* ${lead.decisionMakerName} — ${lead.decisionMakerRole} (confiança ${Math.round(lead.decisionMakerConfidence * 100)}%)`
        : null,
      `⭐ *Score:* ${lead.fitScore}/100 · *Tier ${lead.tier}* · confiança ${lead.confianca}`,
    ].filter(Boolean),
  );

  sections.push([
    lead.suggestedMessage
      ? `💬 *Sugestão de abordagem:*\n${lead.suggestedMessage}`
      : `ℹ️ Dados públicos insuficientes pra sugerir uma abordagem ainda.`,
  ]);

  return sections
    .filter((s) => s.length > 0)
    .map((s) => s.join("\n"))
    .join(`\n${divider}\n`);
}

// ── Maiores cidades/metrópoles do Brasil, usadas quando a rodada é nacional
// (sem cidade fixa). Cobre as 5 regiões pra espalhar os leads pelo país ─────
export const MAJOR_CITIES = [
  ["São Paulo", "SP"], ["Rio de Janeiro", "RJ"], ["Belo Horizonte", "MG"],
  ["Curitiba", "PR"], ["Porto Alegre", "RS"], ["Goiânia", "GO"],
  ["Salvador", "BA"], ["Fortaleza", "CE"], ["Recife", "PE"],
  ["Brasília", "DF"], ["Campinas", "SP"], ["Manaus", "AM"],
  ["Belém", "PA"], ["Florianópolis", "SC"], ["Vitória", "ES"],
];

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Ponto de entrada: descoberta em cascata (Overpass + brasil.io), dedup,
// processa cada candidato e fecha com um resumo da rodada no grupo. Aceita uma
// cidade única (`city`/`uf`) ou uma lista `cities` (rodada nacional: gira por
// várias cidades, pegando um punhado de cada até juntar candidatos) ─────────
export async function runDiscovery({ city, uf, segment, cnae, maxResults = 20, cities = null }) {
  const nationwide = Array.isArray(cities) && cities.length > 0;
  logger.info({ city, uf, segment, cnae, maxResults, nationwide }, "🔎 Iniciando descoberta de leads");

  // Em rodada nacional, embaralha e limita quantas cidades tentar (o Overpass
  // público throttla se batermos em muitas em sequência).
  const targets = nationwide ? shuffle(cities).slice(0, 8) : [[city, uf]];
  const perCity = nationwide ? Math.max(2, Math.ceil(maxResults / 4)) : maxResults;

  let overpassResults = [];
  for (const [c, u] of targets) {
    if (overpassResults.length >= maxResults * 2) break; // já há candidatos de sobra
    try {
      const { boundingbox } = await geocodeCity(c, u);
      let r = await searchBusinesses({ boundingbox, segment, maxResults: perCity });
      r = r.map((business) => ({ ...business, cidade: business.cidade || c, uf: business.uf || u }));
      overpassResults.push(...r);
    } catch (err) {
      logger.warn({ err: err.message, city: c, uf: u, segment }, "Geocode/Overpass falhou pra cidade; seguindo");
    }
  }

  let apifyResults = [];
  if (apifyEnabled()) {
    for (const [c, u] of targets) {
      if (apifyResults.length >= maxResults * 2) break;
      const r = await searchApifyBusinesses({ city: c, uf: u, segment, maxResults: perCity });
      apifyResults.push(...r);
    }
  }

  let brasilioResults = [];
  if (cnae && brasilioEnabled()) {
    const [bc, bu] = targets[0];
    brasilioResults = await searchByCnae({ cnae, municipio: bc, uf: bu, maxResults });
  }

  const businesses = dedupCandidates([...apifyResults, ...overpassResults, ...brasilioResults]).slice(0, maxResults);

  let processed = 0;
  let filtered = 0;
  const leads = [];
  for (const business of businesses) {
    try {
      const { lead, saved, filtered: wasFiltered } = await processCompany(business, segment);
      if (wasFiltered) {
        filtered += 1;
        continue; // empresa grande: fora do alvo, não entra no resumo
      }
      leads.push(lead);
      if (saved) processed += 1;
    } catch (err) {
      logger.error({ err, business: business.nome }, "❌ Falha ao processar negócio");
    }
  }

  if (leads.length || filtered) await notifyLeadsGroup(buildRoundSummary(leads, filtered));

  logger.info({ found: businesses.length, processed, filtered }, "✅ Descoberta de leads concluída");
  return { found: businesses.length, processed, filtered };
}
