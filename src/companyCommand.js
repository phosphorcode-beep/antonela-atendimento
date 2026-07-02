import { logger } from "./logger.js";
import { searchByName } from "./discovery.js";
import { buildLead, formatLeadCard, isValidCnpj } from "./companyIntel.js";
import { upsertCompanyLead } from "./supabase.js";
import { notifyLeadsGroup } from "./notify.js";

const COMMAND_RE = /^\/empresa\s+(.+)$/i;
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

export function isEmpresaCommand(text) {
  return COMMAND_RE.test(text.trim());
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
  const match = text.trim().match(COMMAND_RE);
  if (!match) return;

  const query = parseQuery(match[1]);
  logger.info({ query }, "🔍 Comando /empresa recebido");

  try {
    const lead = await resolveLead(query);

    if (!lead) {
      await notifyLeadsGroup(`Não encontrei nada pra "${match[1].trim()}". Tenta mandar o site ou o CNPJ direto.`);
      return;
    }

    upsertCompanyLead(lead).catch((err) => logger.error({ err }, "Falha ao salvar lead do comando /empresa"));
    await notifyLeadsGroup(formatLeadCard(lead));
  } catch (err) {
    logger.error({ err, query }, "❌ Erro ao processar /empresa");
    await notifyLeadsGroup("Deu erro tentando buscar essa empresa, tenta de novo em instantes.");
  }
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
