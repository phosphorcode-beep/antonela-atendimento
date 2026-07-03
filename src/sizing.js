// ── Classificação de porte da empresa (Receita) e filtro PME/MEI ──────────────
// Códigos de porte da Receita Federal: 01=Microempresa (ME), 03=Empresa de
// Pequeno Porte (EPP), 05=Demais (médio/grande). MEI não é um porte próprio: é
// uma ME com opção pelo Simei. Usamos porte + capital social pra decidir se a
// empresa é do tamanho-alvo (PME/MEI) ou grande demais pra abordagem.

const PORTE_BY_CODE = {
  "1": "ME", "01": "ME",
  "3": "EPP", "03": "EPP",
  "5": "DEMAIS", "05": "DEMAIS",
};

// Normaliza porte a partir de código, texto e flag de MEI vindos de qualquer provider.
export function classifyPorte({ code, text, mei } = {}) {
  if (mei === true) return "MEI";

  const byCode = code != null ? PORTE_BY_CODE[String(code).trim()] : null;
  if (byCode) return byCode;

  const t = String(text || "").toUpperCase();
  if (/DEMAIS|GRANDE/.test(t)) return "DEMAIS";
  if (/PEQUENO|\bEPP\b/.test(t)) return "EPP";
  if (/MICRO|\bMEI\b/.test(t)) return t.includes("MEI") ? "MEI" : "ME";
  if (/\bME\b/.test(t)) return "ME";
  return null;
}

// Ranking de tamanho pra comparar com o teto configurado.
const RANK = { MEI: 1, ME: 2, EPP: 3, DEMAIS: 5 };

// Teto de porte aceito. Default "EPP": aceita MEI/ME/EPP, rejeita Demais.
// PROSPECT_MAX_PORTE = MEI | ME | EPP | DEMAIS ("DEMAIS" desliga o filtro de porte).
function maxPorteRank() {
  const env = String(process.env.PROSPECT_MAX_PORTE || "EPP").toUpperCase();
  return RANK[env] ?? RANK.EPP;
}

// Teto de capital social (pega grandes empresas que vêm marcadas como "Demais"
// mas também as que escapam do porte). Default R$ 10 milhões.
function maxCapital() {
  const v = Number(process.env.PROSPECT_MAX_CAPITAL_SOCIAL);
  return Number.isFinite(v) && v > 0 ? v : 10_000_000;
}

function requireSizeKnown() {
  return String(process.env.PROSPECT_REQUIRE_SIZE_KNOWN ?? "true").toLowerCase() !== "false";
}

function parseCapitalSocial(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.includes(",")
        ? cleaned.replace(",", ".")
        : (cleaned.match(/\./g)?.length ?? 0) > 1
          ? cleaned.replace(/\./g, "")
        : cleaned;

  const capital = Number(normalized);
  return Number.isFinite(capital) ? capital : null;
}

// Decide se o lead é do tamanho-alvo (PME/MEI). Só reprova quando HÁ dado de
// porte/capital. Por padrão, sem dado nenhum também reprova: evita empresa
// grande escapando por vir de fonte sem CNPJ/porte. Use
// PROSPECT_REQUIRE_SIZE_KNOWN=false para voltar ao modo permissivo.
export function evaluateSize({ porte, capitalSocial } = {}) {
  const capital = parseCapitalSocial(capitalSocial);
  const known = Boolean(porte) || capital != null;

  if (!known) {
    return {
      known: false,
      isTarget: !requireSizeKnown(),
      porte: null,
      reason: requireSizeKnown() ? "fora do alvo: porte não confirmado" : "porte não confirmado",
    };
  }

  const rank = porte ? (RANK[porte] ?? RANK.DEMAIS) : RANK.DEMAIS;
  const overPorte = Boolean(porte) && rank > maxPorteRank();
  const overCapital = capital != null && capital > maxCapital();

  if (overPorte || overCapital) {
    const motivo = overCapital
      ? `capital social alto (R$ ${capital.toLocaleString("pt-BR")})`
      : `porte ${porte}`;
    return { known: true, isTarget: false, porte, reason: `fora do alvo: ${motivo}` };
  }

  return { known: true, isTarget: true, porte, reason: porte || "capital compatível" };
}
