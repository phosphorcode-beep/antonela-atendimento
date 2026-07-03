export const NICHE_PROFILES = [
  {
    priority: 1,
    segment: "industria",
    label: "indústrias pequenas e médias",
    shortLabel: "indústrias",
    cnaeEnv: ["PROSPECT_INDUSTRIA_CNAE"],
    aliases: ["industria", "industrias", "fabrica", "fabricas", "manufatura", "producao", "chao de fabrica"],
    pain: "produção, estoque, OS, manutenção e qualidade sem rastreabilidade",
    outreachPain: "produção, estoque, OS e rastreabilidade",
    offer: "apontamento de produção, controle de OS, manutenção preventiva, rastreabilidade e dashboards",
  },
  {
    priority: 2,
    segment: "distribuidora",
    label: "distribuidoras e atacadistas",
    shortLabel: "distribuidoras",
    cnaeEnv: ["PROSPECT_DISTRIBUIDORA_CNAE", "PROSPECT_ATACADO_CNAE", "PROSPECT_VAREJO_CNAE"],
    aliases: ["distribuidora", "distribuidoras", "atacadista", "atacadistas", "atacado", "estoque", "expedicao", "entrega", "logistica"],
    pain: "pedido, estoque, expedição, entrega e ERP desconectados",
    outreachPain: "pedidos, estoque, expedição e entregas",
    offer: "portal operacional com pedidos, estoque, separação, faturamento, rotas e integração com ERP",
  },
  {
    priority: 3,
    segment: "servicos_campo",
    label: "empresas de serviços em campo",
    shortLabel: "serviços em campo",
    cnaeEnv: ["PROSPECT_SERVICOS_CAMPO_CNAE"],
    aliases: ["servicos em campo", "servico em campo", "campo", "assistencia tecnica", "assistencias tecnicas", "manutencao", "instalacao", "laudo", "laudos", "equipes externas"],
    pain: "equipes externas, visitas, laudos, fotos, checklists e SLA no WhatsApp",
    outreachPain: "agenda técnica, OS, laudos, fotos e SLA",
    offer: "agenda técnica, ordens de serviço, laudos digitais, assinatura, fotos e acompanhamento",
  },
  {
    priority: 4,
    segment: "clinicas",
    label: "clínicas, laboratórios e estética avançada",
    shortLabel: "clínicas",
    cnaeEnv: ["PROSPECT_CLINICAS_CNAE", "PROSPECT_SAUDE_CNAE"],
    aliases: ["clinica", "clinicas", "laboratorio", "laboratorios", "estetica", "estetica avancada", "saude", "consultorio", "consultorios", "odontologia", "dentista"],
    pain: "agenda, prontuário, financeiro, estoque e dados sensíveis espalhados",
    outreachPain: "agenda, prontuário/processos, financeiro e estoque",
    offer: "gestão operacional integrada com agenda, prontuário/processos, permissões, relatórios e LGPD",
  },
  {
    priority: 5,
    segment: "franquias",
    label: "franquias e redes locais",
    shortLabel: "franquias",
    cnaeEnv: ["PROSPECT_FRANQUIAS_CNAE"],
    aliases: ["franquia", "franquias", "rede local", "redes locais", "multiunidade", "multi unidade", "unidades"],
    pain: "unidades operando de formas diferentes e pouca visão do dono",
    outreachPain: "padronização entre unidades, auditoria e indicadores",
    offer: "padronização operacional, auditoria, indicadores por unidade e central de chamados",
  },
  {
    priority: 6,
    segment: "agro",
    label: "agro, alimentos e operações rastreáveis",
    shortLabel: "agro e alimentos",
    cnaeEnv: ["PROSPECT_AGRO_CNAE", "PROSPECT_ALIMENTOS_CNAE"],
    aliases: ["agro", "agronegocio", "agricola", "alimentos", "rastreabilidade", "lote", "lotes", "validade", "fornecedores"],
    pain: "controle de lote, produção, fornecedores, validade e conformidade",
    outreachPain: "lotes, produção, fornecedores, validade e conformidade",
    offer: "rastreabilidade, entrada/saída, lote, checklist e relatórios gerenciais",
  },
];

const LEGACY_SEGMENTS = {
  saude: "clinicas",
  varejo: "distribuidora",
};

export function normalizeText(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getNicheProfile(segment) {
  const normalized = normalizeText(segment);
  const canonical = LEGACY_SEGMENTS[normalized] || normalized;
  return NICHE_PROFILES.find((profile) => profile.segment === canonical) || null;
}

export function resolveNiche(raw) {
  const normalized = normalizeText(raw);
  if (!normalized) return { status: "missing" };

  const profile = NICHE_PROFILES.find((item) =>
    item.aliases.some((alias) => normalized.includes(normalizeText(alias))),
  );

  return profile ? { status: "supported", ...profile } : { status: "unsupported", raw };
}

export function supportedNicheLabels() {
  return NICHE_PROFILES.map((niche) => niche.shortLabel).join(", ");
}

// ── Classifica um texto livre (conversa, formulário) em um nicho, ou null ──────
// Diferente de resolveNiche, devolve direto o perfil (ou null) pra usar como
// palpite de segmento em leads inbound, sem os estados missing/unsupported.
export function classifyNiche(text) {
  const result = resolveNiche(text);
  return result.status === "supported" ? result : null;
}

export function cnaeFromEnv(profile) {
  for (const envName of profile.cnaeEnv || []) {
    const value = process.env[envName];
    if (value) return value;
  }
  return null;
}

