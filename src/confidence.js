// ── Nível de confiança no decisor/dados do lead, baseado em quantas fontes
// independentes concordam — não em achismo. Ver metodologia no plano: ALTA
// exige ≥2 fontes confirmando o mesmo decisor (ex: QSA + menção/contato pessoal);
// LinkedIn empresarial não conta como fonte do decisor. MÉDIA é
// 1 fonte só; BAIXA é quando não há decisor identificado ────────────────────
export function computeConfidence(lead) {
  const decisorFontes = (lead.fontes ?? []).filter((f) =>
    ["qsa", "brave-decisor", "brave-decisor-contato"].includes(f),
  );

  if (!lead.decisionMakerName) return "baixa";
  if (decisorFontes.length >= 2) return "alta";
  return "media";
}

// ── Tier de ação: A = pode disparar abordagem já; B = acionável mas com
// ressalva; C = dados fracos demais, precisa de revisão humana antes ────────
export function computeTier(lead, confidence) {
  const temContatoDecisor = Boolean(
    lead.decisionMakerPhone ||
      lead.decisionMakerWhatsapp ||
      lead.decisionMakerEmail ||
      lead.decisionMakerLinkedin ||
      lead.decisionMakerInstagram,
  );
  const temContatoAcionavel = temContatoDecisor || Boolean(lead.telefone || lead.whatsapp || lead.email);

  if (lead.fitScore >= 60 && temContatoDecisor && confidence !== "baixa") return "A";
  if (lead.fitScore >= 35 && temContatoAcionavel) return "B";
  return "C";
}
