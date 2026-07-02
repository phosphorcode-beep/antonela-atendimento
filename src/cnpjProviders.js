import { logger } from "./logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cache em memória (evita bater 2x no mesmo CNPJ na mesma execução) ────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // cnpj → { data, ts }

function getCached(cnpj) {
  const hit = cache.get(cnpj);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  return null;
}

function setCached(cnpj, data) {
  cache.set(cnpj, { data, ts: Date.now() });
}

// ── Rate limiter simples por provider (respeita limites documentados) ────────
const lastCallAt = new Map(); // provider → timestamp

async function throttle(provider, minIntervalMs) {
  const last = lastCallAt.get(provider) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(provider, Date.now());
}

async function fetchWithRetry(url, { retries = 2, ...opts } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res.json();
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return null; // CNPJ não encontrado etc.
    if (attempt < retries) await sleep(attempt * 1000);
  }
  return null;
}

function firstOf(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => o?.[part], obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function isAtiva(situacao) {
  if (!situacao) return null;
  return /ativa/i.test(situacao);
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

function lower(v) {
  return v ? String(v).toLowerCase() : v;
}

function normalizeQsa(rawList, keyMap) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((s) => ({
    nome: firstOf(s, keyMap.nome) ?? null,
    qualificacao: firstOf(s, keyMap.qualificacao) ?? null,
  }));
}

// ── CNPJá (open.cnpja.com) — 5 req/min ────────────────────────────────────────
async function fetchCnpja(cnpj) {
  await throttle("cnpja", 12_000);
  const data = await fetchWithRetry(`https://open.cnpja.com/office/${cnpj}`);
  if (!data) return null;

  const phone = data.phones?.[0];

  return {
    razaoSocial: firstOf(data, ["company.name", "razaoSocial"]),
    nomeFantasia: firstOf(data, ["alias", "nomeFantasia"]),
    telefone: phone ? normalizePhone(`${phone.area ?? ""}${phone.number ?? ""}`) : null,
    email: lower(firstOf(data, ["emails.0.address", "email"])),
    cnaePrincipal: firstOf(data, ["mainActivity.id", "cnaePrincipal"]),
    cnaeDescricao: firstOf(data, ["mainActivity.text", "cnaeDescricao"]),
    cidade: firstOf(data, ["address.city", "cidade"]),
    uf: firstOf(data, ["address.state", "uf"]),
    endereco: firstOf(data, ["address.street", "endereco"]),
    matriz: firstOf(data, ["head"]) === true,
    porteCode: firstOf(data, ["company.size.id"]),
    porteText: firstOf(data, ["company.size.text", "company.size.acronym"]),
    capitalSocial: firstOf(data, ["company.equity"]),
    mei: firstOf(data, ["company.simei.optant"]) === true,
    situacaoAtiva: isAtiva(firstOf(data, ["status.text", "situacao"])),
    qsa: normalizeQsa(data.company?.members ?? data.qsa, {
      nome: ["person.name", "nome"],
      qualificacao: ["role.text", "qualificacao"],
    }),
    source: "cnpja",
  };
}

// ── CNPJ.ws (publica.cnpj.ws) — 3 req/min ─────────────────────────────────────
async function fetchCnpjWs(cnpj) {
  await throttle("cnpjws", 20_000);
  const data = await fetchWithRetry(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if (!data) return null;

  const est = data.estabelecimento ?? {};

  return {
    razaoSocial: firstOf(data, ["razao_social"]),
    nomeFantasia: firstOf(data, ["estabelecimento.nome_fantasia"]),
    telefone: est.ddd1 ? normalizePhone(`${est.ddd1}${est.telefone1 ?? ""}`) : normalizePhone(est.telefone1),
    email: lower(firstOf(data, ["estabelecimento.email", "email"])),
    cnaePrincipal: firstOf(data, ["estabelecimento.atividade_principal.id"]),
    cnaeDescricao: firstOf(data, ["estabelecimento.atividade_principal.descricao"]),
    cidade: firstOf(data, ["estabelecimento.cidade.nome"]),
    uf: firstOf(data, ["estabelecimento.estado.sigla"]),
    endereco: firstOf(data, ["estabelecimento.logradouro"]),
    matriz: firstOf(data, ["estabelecimento.tipo"]) === "Matriz",
    porteCode: firstOf(data, ["porte.id", "codigo_porte"]),
    porteText: firstOf(data, ["porte.descricao", "porte"]),
    capitalSocial: firstOf(data, ["capital_social"]),
    mei: firstOf(data, ["simples.mei", "simei"]) === "Sim" || firstOf(data, ["estabelecimento.simei"]) === true,
    situacaoAtiva: isAtiva(firstOf(data, ["estabelecimento.situacao_cadastral"])),
    qsa: normalizeQsa(data.socios, {
      nome: ["nome", "nome_socio"],
      qualificacao: ["qualificacao_socio.descricao", "qualificacao"],
    }),
    source: "cnpjws",
  };
}

// ── Minha Receita (minhareceita.org) ──────────────────────────────────────────
async function fetchMinhaReceita(cnpj) {
  await throttle("minhareceita", 5_000);
  const data = await fetchWithRetry(`https://minhareceita.org/${cnpj}`);
  if (!data) return null;

  return {
    razaoSocial: firstOf(data, ["razao_social"]),
    nomeFantasia: firstOf(data, ["nome_fantasia"]),
    telefone: normalizePhone(firstOf(data, ["ddd_telefone_1"])),
    email: lower(firstOf(data, ["email"])),
    cnaePrincipal: firstOf(data, ["cnae_fiscal"]),
    cnaeDescricao: firstOf(data, ["cnae_fiscal_descricao"]),
    cidade: firstOf(data, ["municipio"]),
    uf: firstOf(data, ["uf"]),
    endereco: firstOf(data, ["logradouro"]),
    matriz: firstOf(data, ["identificador_matriz_filial"]) === 1,
    porteCode: firstOf(data, ["codigo_porte"]),
    porteText: firstOf(data, ["porte"]),
    capitalSocial: firstOf(data, ["capital_social"]),
    mei: firstOf(data, ["opcao_pelo_mei"]) === true || /sim/i.test(String(firstOf(data, ["opcao_pelo_mei"]) ?? "")),
    situacaoAtiva: isAtiva(firstOf(data, ["descricao_situacao_cadastral"])),
    qsa: normalizeQsa(data.qsa, {
      nome: ["nome_socio"],
      qualificacao: ["qualificacao_socio"],
    }),
    source: "minhareceita",
  };
}

// ── BrasilAPI (brasilapi.com.br) — espelho dos Dados Abertos da Receita.
// Exige User-Agent de browser (Cloudflare bloqueia UA não-browser com 403). ──
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchBrasilApi(cnpj) {
  await throttle("brasilapi", 3_000);
  const data = await fetchWithRetry(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
  });
  if (!data) return null;

  return {
    razaoSocial: firstOf(data, ["razao_social"]),
    nomeFantasia: firstOf(data, ["nome_fantasia"]),
    telefone: normalizePhone(firstOf(data, ["ddd_telefone_1"])),
    email: lower(firstOf(data, ["email"])),
    cnaePrincipal: firstOf(data, ["cnae_fiscal"]),
    cnaeDescricao: firstOf(data, ["cnae_fiscal_descricao"]),
    cidade: firstOf(data, ["municipio"]),
    uf: firstOf(data, ["uf"]),
    endereco: firstOf(data, ["logradouro"]),
    matriz: firstOf(data, ["identificador_matriz_filial"]) === 1,
    porteCode: firstOf(data, ["codigo_porte"]),
    porteText: firstOf(data, ["porte", "descricao_porte"]),
    capitalSocial: firstOf(data, ["capital_social"]),
    mei: firstOf(data, ["opcao_pelo_mei"]) === true,
    situacaoAtiva: isAtiva(firstOf(data, ["descricao_situacao_cadastral"])),
    qsa: normalizeQsa(data.qsa, {
      nome: ["nome_socio"],
      qualificacao: ["qualificacao_socio"],
    }),
    source: "brasilapi",
  };
}

// ── OpenCNPJ — 100 req/min ─────────────────────────────────────────────────────
async function fetchOpenCnpj(cnpj) {
  await throttle("opencnpj", 700);
  const raw = await fetchWithRetry(`https://kitana.opencnpj.com/cnpj/${cnpj}`);
  const data = raw?.data; // resposta vem envelopada em { success, message, data }
  if (!data) return null;

  return {
    razaoSocial: firstOf(data, ["razaoSocial"]),
    nomeFantasia: firstOf(data, ["nomeFantasia"]),
    telefone: normalizePhone(firstOf(data, ["telefone"])),
    email: lower(firstOf(data, ["email"])),
    cnaePrincipal: firstOf(data, ["cnaes.0.cnae"]),
    cnaeDescricao: firstOf(data, ["cnaes.0.descricao"]),
    cidade: firstOf(data, ["municipio"]),
    uf: firstOf(data, ["uf"]),
    endereco: firstOf(data, ["logradouro"]),
    matriz: firstOf(data, ["matriz"]) === "Sim",
    porteCode: firstOf(data, ["codigoPorte", "porte.codigo"]),
    porteText: firstOf(data, ["porte", "descricaoPorte"]),
    capitalSocial: firstOf(data, ["capitalSocial", "capital_social"]),
    mei: firstOf(data, ["opcaoMei", "mei"]) === true || firstOf(data, ["opcaoMei"]) === "Sim",
    situacaoAtiva: isAtiva(firstOf(data, ["situacaoCadastral"])),
    qsa: normalizeQsa(data.socios, {
      nome: ["nomeSocio"],
      qualificacao: ["descricao"],
    }),
    source: "opencnpj",
  };
}

const PROVIDERS = [fetchCnpja, fetchBrasilApi, fetchCnpjWs, fetchMinhaReceita, fetchOpenCnpj];

// ── Tenta cada provider em ordem até um responder ─────────────────────────────
export async function enrichByCnpj(cnpj) {
  const cached = getCached(cnpj);
  if (cached) return cached;

  for (const provider of PROVIDERS) {
    try {
      const result = await provider(cnpj);
      if (result) {
        setCached(cnpj, result);
        return result;
      }
    } catch (err) {
      logger.warn({ err: err.message, cnpj, provider: provider.name }, "Provider de CNPJ falhou, tentando próximo");
    }
  }

  logger.warn({ cnpj }, "❌ Nenhum provider gratuito retornou dados para o CNPJ");
  return null;
}
