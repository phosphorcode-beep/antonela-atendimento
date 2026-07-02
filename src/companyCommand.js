import { logger } from "./logger.js";
import { searchByName } from "./discovery.js";
import { buildLead, formatLeadCard, isValidCnpj, runDiscovery, toStructuredOutput } from "./companyIntel.js";
import { prospectingEnabled, upsertCompanyLead } from "./supabase.js";
import { notifyLeadsGroup } from "./notify.js";

const EMPRESA_COMMAND_RE = /^\/empresa\s+(.+)$/i;
const PROSPECT_COMMAND_RE = /^\/?prospect(?:e|ar)?\s+(\d{1,3})\s+(?:empresas?|leads?)(?:\s+(?:(?:de|do|da|dos|das|em|no|na|nos|nas)\s+)?(.+))?$/i;
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const MAX_PROSPECT_RESULTS = 50;

const SUPPORTED_NICHES = [
  {
    segment: "saude",
    label: "saúde",
    cnaeEnv: "PROSPECT_SAUDE_CNAE",
    aliases: ["saude", "clinica", "clinicas", "consultorio", "medico", "medicos", "odontologia", "dentista", "hospital", "laboratorio", "farmacia", "farmacias"],
  },
  {
    segment: "varejo",
    label: "varejo",
    cnaeEnv: "PROSPECT_VAREJO_CNAE",
    aliases: ["varejo", "loja", "lojas", "comercio", "mercado", "supermercado", "moda", "boutique", "ecommerce", "e-commerce"],
  },
];

export function isEmpresaCommand(text) {
  return EMPRESA_COMMAND_RE.test(text.trim());
}

export function isProspectingCommand(text) {
  return Boolean(parseProspectingCommand(text));
}

function normalizeText(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveNiche(raw) {
  const normalized = normalizeText(raw);
  if (!normalized) return { status: "missing" };

  const niche = SUPPORTED_NICHES.find((item) =>
    item.aliases.some((alias) => normalized.includes(alias)),
  );

  return niche ? { status: "supported", ...niche } : { status: "unsupported", raw };
}

export function parseProspectingCommand(text) {
  const match = text.trim().match(PROSPECT_COMMAND_RE);
  if (!match) return null;

  const requested = Number(match[1]);
  if (!Number.isInteger(requested) || requested < 1) return null;

  const maxResults = Math.min(requested, MAX_PROSPECT_RESULTS);
  const nicheRaw = match[2]?.trim() || null;

  return {
    requested,
    maxResults,
    capped: requested > maxResults,
    niche: resolveNiche(nicheRaw),
  };
}

// ── Detecta se o usuário mandou CNPJ, site ou nome da empresa ────────────────
function parseQuery(raw) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 14 && isValidCnpj(digits)) {
    return { type: "cnpj", value: digits };
  }
  if (!trimmed.includes(" ") && WEBSITE_RE.test(trimmed)) {
    return { type: "website", value: trimmed };
  }
  return { type: "name", value: trimmed };
}

// ── Comando /empresa <nome|site|cnpj>, disparado no grupo Phosphor Leads ────
export async function handleEmpresaCommand(text) {
  const match = text.trim().match(EMPRESA_COMMAND_RE);
  if (!match) return;

  const query = parseQuery(match[1]);
  logger.info({ query }, "🔍 Comando /empresa recebido");

  try {
    const lead = await resolveLead(query);

    if (!lead) {
      await notifyLeadsGroup(`Não encontrei nada pra "${match[1].trim()}". Tenta mandar o site ou o CNPJ direto.`);
      return;
    }

    logger.info(toStructuredOutput(lead), "📊 Lead processado (/empresa)");
    upsertCompanyLead(lead).catch((err) => logger.error({ err }, "Falha ao salvar lead do comando /empresa"));
    await notifyLeadsGroup(formatLeadCard(lead));
  } catch (err) {
    logger.error({ err, query }, "❌ Erro ao processar /empresa");
    await notifyLeadsGroup("Deu erro tentando buscar essa empresa, tenta de novo em instantes.");
  }
}

// ── Comando "prospecte N empresas de <nicho>", disparado no grupo Phosphor Leads
export async function handleProspectingCommand(text) {
  const command = parseProspectingCommand(text);
  if (!command) return;

  if (command.niche.status === "missing") {
    await notifyLeadsGroup(
      "Boa. Só falta o nicho.\n\nUse assim:\nprospecte 10 empresas de saúde\nprospecte 10 empresas de varejo",
    );
    return;
  }

  if (command.niche.status === "unsupported") {
    const supported = SUPPORTED_NICHES.map((n) => n.label).join(" ou ");
    await notifyLeadsGroup(
      `Ainda não tenho esse nicho mapeado. Por enquanto eu entendo ${supported}.\n\nExemplo: prospecte 10 empresas de saúde`,
    );
    return;
  }

  if (!prospectingEnabled()) {
    await notifyLeadsGroup("Prospecção ainda não está ativa. Configure SUPABASE_URL e SUPABASE_SERVICE_KEY primeiro.");
    return;
  }

  const city = process.env.PROSPECT_TARGET_CITY || "Brasília";
  const uf = process.env.PROSPECT_TARGET_UF || "DF";
  const cnae = process.env[command.niche.cnaeEnv] || null;
  const capNotice = command.capped ? ` Limitei em ${command.maxResults} para não pesar nas fontes gratuitas.` : "";

  await notifyLeadsGroup(
    `Fechado. Vou prospectar ${command.maxResults} empresas de ${command.niche.label} em ${city}/${uf}.${capNotice}\nVou mandando os leads aqui conforme encontrar.`,
  );

  runDiscovery({
    city,
    uf,
    segment: command.niche.segment,
    cnae,
    maxResults: command.maxResults,
  })
    .then(async ({ found }) => {
      if (found === 0) {
        await notifyLeadsGroup(`Não encontrei empresas de ${command.niche.label} em ${city}/${uf} nessa rodada.`);
      }
    })
    .catch(async (err) => {
      logger.error({ err }, "❌ Erro ao processar comando de prospecção");
      await notifyLeadsGroup("Deu erro tentando prospectar agora. Tenta de novo em instantes.");
    });
}

async function resolveLead(query) {
  if (query.type === "cnpj") {
    return buildLead({ nome: null, telefone: null, website: null, endereco: null, cnpj: query.value, source: "manual-cnpj" }, null);
  }

  if (query.type === "website") {
    return buildLead({ nome: null, telefone: null, website: query.value, endereco: null, source: "manual-site" }, null);
  }

  // Nome: busca best-effort restrita à cidade-alvo (ver PROSPECT_TARGET_CITY/UF)
  const businesses = await searchByName(query.value, { maxResults: 3 });
  const business = businesses.find((b) => b.nome.toLowerCase().includes(query.value.toLowerCase())) ?? businesses[0];
  if (!business) return null;

  return buildLead(business, null);
}
