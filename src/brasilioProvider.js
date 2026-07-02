import { logger } from "./logger.js";

// ── Descoberta por CNAE + município via brasil.io. Diferente das 4 APIs de
// CNPJ (que só consultam por CNPJ exato), o brasil.io ingere os dados abertos
// da Receita Federal e permite BUSCAR empresas por CNAE/município — é a peça
// que faltava pra descoberta B2B de verdade, sem depender só do Overpass.
//
// Exige conta grátis em brasil.io + token (BRASILIO_API_TOKEN). Sem token,
// essa fonte fica desativada e a descoberta cai só pro Overpass.
//
// Aviso: os nomes de campo abaixo seguem o padrão dos Dados Abertos da Receita
// Federal (mesma origem usada pela Minha Receita), mas não foram testados ao
// vivo aqui porque exigem token — confira na primeira execução real e ajuste
// se o brasil.io usar nomes diferentes. ────────────────────────────────────
const BASE_URL = "https://api.brasil.io/v1/dataset/socios-brasil/empresas/data/";

export function brasilioEnabled() {
  return Boolean(process.env.BRASILIO_API_TOKEN);
}

function firstOf(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function isAtiva(situacao) {
  if (!situacao) return null;
  return /ativa/i.test(situacao);
}

// ── Busca empresas por CNAE + município, retorna no formato "business" usado
// por discovery.js (compatível com o pipeline de dedup/enriquecimento) ──────
export async function searchByCnae({ cnae, municipio, uf, maxResults = 20 }) {
  if (!brasilioEnabled()) return [];

  const url = new URL(BASE_URL);
  if (cnae) url.searchParams.set("cnae_fiscal", cnae);
  if (municipio) url.searchParams.set("municipio", municipio.toUpperCase());
  if (uf) url.searchParams.set("uf", uf.toUpperCase());
  url.searchParams.set("situacao_cadastral", "ATIVA");
  url.searchParams.set("page_size", String(Math.min(maxResults, 100)));

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${process.env.BRASILIO_API_TOKEN}` },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "brasil.io retornou erro na busca por CNAE");
      return [];
    }

    const data = await res.json();
    const results = (data.results ?? []).slice(0, maxResults);

    const businesses = results
      .map((r) => {
        const nome = firstOf(r, ["nome_fantasia", "razao_social"]);
        if (!nome) return null;
        const cnpjRaw = firstOf(r, ["cnpj"]);
        return {
          nome,
          cnpj: cnpjRaw ? String(cnpjRaw).replace(/\D/g, "") : null,
          razaoSocial: firstOf(r, ["razao_social"]),
          telefone: firstOf(r, ["ddd_telefone_1", "telefone1"]),
          endereco: firstOf(r, ["logradouro"]),
          cidade: firstOf(r, ["municipio"]),
          uf: firstOf(r, ["uf"]),
          cnaePrincipal: firstOf(r, ["cnae_fiscal"]),
          cnaeDescricao: firstOf(r, ["cnae_fiscal_descricao"]),
          situacaoAtiva: isAtiva(firstOf(r, ["descricao_situacao_cadastral", "situacao_cadastral"])),
          website: null,
          source: "brasilio",
        };
      })
      .filter(Boolean);

    logger.info({ cnae, municipio, uf, count: businesses.length }, "🏢 Empresas encontradas via brasil.io");
    return businesses;
  } catch (err) {
    logger.error({ err: err.message }, "❌ Falha na busca por CNAE no brasil.io");
    return [];
  }
}
