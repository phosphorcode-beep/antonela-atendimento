// ── Nível de confiança no decisor/dados do lead, baseado em quantas fontes
// independentes concordam — não em achismo. Ver metodologia no plano: ALTA
// exige ≥2 fontes confirmando o mesmo decisor (ex: QSA + LinkedIn); MÉDIA é
// 1 fonte só; BAIXA é quando não há decisor identificado ────────────────────
export function computeConfidence(lead) {
  const decisorFontes = (lead.fontes ?? []).filter((f) =>
    ["qsa", "brave-linkedin", "brave-decisor"].includes(f),
  );

  if (!lead.decisionMakerName) return "baixa";
  if (decisorFontes.length >= 2) return "alta";
  return "media";
}

// ── Tier de ação: A = pode disparar abordagem já; B = acionável mas com
// ressalva; C = dados fracos demais, precisa de revisão humana antes ────────
export function computeTier(lead, confidence) {
  const temContatoAcionavel = Boolean(lead.telefone || lead.whatsapp || lead.email);

  if (lead.fitScore >= 60 && temContatoAcionavel && confidence !== "baixa") return "A";
  if (lead.fitScore >= 35 && temContatoAcionavel) return "B";
  return "C";
}
