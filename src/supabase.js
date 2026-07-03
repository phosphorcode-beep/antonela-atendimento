import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { logger } from "./logger.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TABLE = "prospecting_leads";
const COMPANY_TABLE = "company_leads";

let client = null;

export function prospectingEnabled() {
  return Boolean(SUPABASE_URL) && Boolean(SUPABASE_SERVICE_KEY);
}

// ── Node 20 (usado no container de produção) não tem WebSocket nativo, e o
// cliente realtime do supabase-js exige um mesmo sem usarmos realtime.
// Passar o "ws" como transport evita o crash na construção do client. ────────
function getClient() {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    realtime: { transport: WebSocket },
  });
  return client;
}

// ── Insere/atualiza leads importados da planilha (não mexe em quem já está em cadência) ──
export async function upsertLeads(rows) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      rows.map((r) => ({
        phone: r.phone,
        name: r.name ?? null,
        company: r.company ?? null,
      })),
      { onConflict: "phone", ignoreDuplicates: true },
    )
    .select();

  if (error) {
    logger.error({ err: error }, "❌ Erro ao importar leads no Supabase");
    throw error;
  }
  return data ?? [];
}

// ── Busca leads com próximo toque vencido ─────────────────────────────────────
export async function getDueLeads(limit) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .in("status", ["pending", "contacted_d0", "contacted_d3"])
    .lte("next_touch_at", new Date().toISOString())
    .order("next_touch_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error({ err: error }, "❌ Erro ao buscar leads vencidos");
    return [];
  }
  return data ?? [];
}

// ── Atualiza lead após envio de um toque ──────────────────────────────────────
export async function markTouchSent(id, { status, nextTouchAt, touchCount }) {
  const db = getClient();
  const { error } = await db
    .from(TABLE)
    .update({
      status,
      touch_count: touchCount,
      next_touch_at: nextTouchAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) logger.error({ err: error, id }, "❌ Erro ao atualizar lead após toque");
}

// ── Encontra lead ativo (ainda em cadência) pelo telefone ─────────────────────
export async function findActiveLeadByPhone(phone) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("phone", phone)
    .in("status", ["pending", "contacted_d0", "contacted_d3"])
    .maybeSingle();

  if (error) {
    logger.error({ err: error, phone }, "❌ Erro ao buscar lead por telefone");
    return null;
  }
  return data;
}

export async function markReplied(phone) {
  const db = getClient();
  await db
    .from(TABLE)
    .update({ status: "replied", updated_at: new Date().toISOString() })
    .eq("phone", phone);
}

export async function markOptedOut(phone) {
  const db = getClient();
  await db
    .from(TABLE)
    .update({ status: "opted_out", updated_at: new Date().toISOString() })
    .eq("phone", phone);
}

// ── Empresas descobertas pela prospecção ativa (Free Prospecting Intelligence) ──

// ── Salva/atualiza um lead de empresa; evita duplicar quem já foi notificado ──
export async function upsertCompanyLead(lead) {
  const db = getClient();

  const existing = await findExistingCompanyLead(lead);
  if (existing?.notified) return null; // já processado antes, não notifica de novo

  const row = {
    cnpj: lead.cnpj,
    razao_social: lead.razaoSocial,
    nome_fantasia: lead.nomeFantasia,
    telefone: lead.telefone,
    email: lead.email,
    website: lead.website,
    instagram: lead.instagram,
    linkedin: lead.linkedin,
    whatsapp: lead.whatsapp,
    cnae_principal: lead.cnaePrincipal,
    cnae_descricao: lead.cnaeDescricao,
    cidade: lead.cidade,
    uf: lead.uf,
    endereco: lead.endereco,
    decision_maker_name: lead.decisionMakerName,
    decision_maker_role: lead.decisionMakerRole,
    decision_maker_confidence: lead.decisionMakerConfidence,
    fit_score: lead.fitScore,
    suggested_message: lead.suggestedMessage,
    source: lead.source,
    segment: lead.segment ?? null,
    fontes: lead.fontes ?? null,
    lacunas: lead.lacunas ?? null,
    confianca: lead.confianca ?? null,
    tier: lead.tier ?? null,
    enrichment_status: lead.enrichmentStatus,
    notified: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await db.from(COMPANY_TABLE).update(row).eq("id", existing.id).select().single();
    if (error) {
      logger.error({ err: error }, "❌ Erro ao atualizar company_lead");
      return null;
    }
    return data;
  }

  const { data, error } = await db.from(COMPANY_TABLE).insert(row).select().single();
  if (error) {
    logger.error({ err: error }, "❌ Erro ao salvar company_lead");
    return null;
  }
  return data;
}

// ── Salva/atualiza um lead inbound (chegou sozinho no WhatsApp ou pelo site e
// se qualificou na conversa). Deduplica pelo telefone; se já existir (inclusive
// vindo da prospecção ativa), completa só os campos vazios, sem sobrescrever
// dados já enriquecidos. Unifica inbound e prospecção na mesma company_leads. ──
export async function upsertInboundLead(lead) {
  const db = getClient();
  const phone = String(lead.phone || "").split("@")[0].replace(/\D/g, "");
  if (!phone) return null;

  const existing = await findCompanyLeadByPhone(phone);

  const full = {
    telefone: phone,
    whatsapp: phone,
    nome_fantasia: lead.company || null,
    decision_maker_name: lead.name || null,
    segment: lead.segment || null,
    source: lead.source || "inbound-whatsapp",
    enrichment_status: "partial",
    lacunas: lead.lacunas ?? null,
    notified: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Só preenche o que está vazio no registro atual, pra não apagar enriquecimento.
    const patch = { updated_at: full.updated_at };
    for (const [key, value] of Object.entries(full)) {
      if (key === "updated_at") continue;
      if (value != null && (existing[key] == null || existing[key] === "")) patch[key] = value;
    }
    const { data, error } = await db.from(COMPANY_TABLE).update(patch).eq("id", existing.id).select().single();
    if (error) {
      logger.error({ err: error }, "❌ Erro ao atualizar lead inbound");
      return null;
    }
    return data;
  }

  const { data, error } = await db.from(COMPANY_TABLE).insert(full).select().single();
  if (error) {
    logger.error({ err: error }, "❌ Erro ao salvar lead inbound");
    return null;
  }
  return data;
}

async function findCompanyLeadByPhone(phone) {
  const db = getClient();
  const { data } = await db
    .from(COMPANY_TABLE)
    .select("*")
    .or(`whatsapp.eq.${phone},telefone.eq.${phone}`)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findExistingCompanyLead(lead) {
  const db = getClient();

  if (lead.cnpj) {
    const { data } = await db.from(COMPANY_TABLE).select("*").eq("cnpj", lead.cnpj).maybeSingle();
    if (data) return data;
  }

  if (lead.nomeFantasia && lead.cidade) {
    const { data } = await db
      .from(COMPANY_TABLE)
      .select("*")
      .eq("nome_fantasia", lead.nomeFantasia)
      .eq("cidade", lead.cidade)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}
