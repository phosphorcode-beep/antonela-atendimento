import { sendWhatsAppMessage } from "./evolution.js";
import { enrichByCnpj } from "./cnpjProviders.js";
import { getHistory, saveHistory } from "./history.js";
import { logger } from "./logger.js";
import { classifyPorte, evaluateSize } from "./sizing.js";
import { notifyLeadsGroup } from "./notify.js";
import {
  prospectingEnabled,
  getDueCompanyOutreachLeads,
  markCompanyOutreachSent,
  markCompanyOutreachError,
  markCompanyOutreachManual,
  markCompanyOutreachBlocked,
  updateCompanyLeadSize,
  findActiveCompanyLeadByPhone,
  markCompanyLeadReplied,
  markCompanyLeadOptedOut,
} from "./supabase.js";

const OPT_OUT_RE = /\b(parar|para\s+de\s+enviar|sair|remov[ae]|descadastr\w*|n[aã]o\s+perturbe|n[aã]o\s+quero)\b/i;
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const BUSINESS_START = Number(process.env.COMPANY_OUTREACH_START_HOUR ?? 7);
const BUSINESS_END = Number(process.env.COMPANY_OUTREACH_END_HOUR ?? 18);
const FOLLOW_UP_INTERVAL_HOURS = Number(process.env.COMPANY_OUTREACH_INTERVAL_HOURS ?? 6);
const MAX_TOUCHES = Number(process.env.COMPANY_OUTREACH_MAX_TOUCHES ?? 3);

function brtParts(date = new Date()) {
  const brt = new Date(date.getTime() - BRT_OFFSET_MS);
  return {
    year: brt.getUTCFullYear(),
    month: brt.getUTCMonth(),
    day: brt.getUTCDate(),
    weekday: brt.getUTCDay(),
    hour: brt.getUTCHours(),
    minute: brt.getUTCMinutes(),
    second: brt.getUTCSeconds(),
  };
}

function utcFromBrt({ year, month, day, hour, minute = 0, second = 0 }) {
  return new Date(Date.UTC(year, month, day, hour + 3, minute, second));
}

function isBusinessTime(date = new Date()) {
  const p = brtParts(date);
  const weekday = p.weekday >= 1 && p.weekday <= 5;
  return weekday && p.hour >= BUSINESS_START && p.hour < BUSINESS_END;
}

function nextBusinessStart(date = new Date()) {
  let p = brtParts(date);
  let candidate = utcFromBrt({ ...p, hour: BUSINESS_START, minute: 0, second: 0 });

  if (p.weekday === 0 || p.weekday === 6 || p.hour >= BUSINESS_END || date > candidate) {
    do {
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      p = brtParts(candidate);
    } while (p.weekday === 0 || p.weekday === 6);
  }

  return candidate;
}

function nextCompanyOutreachAt(from = new Date()) {
  const target = new Date(from.getTime() + FOLLOW_UP_INTERVAL_HOURS * 60 * 60 * 1000);
  return isBusinessTime(target) ? target : nextBusinessStart(target);
}

function firstName(lead) {
  return String(lead.decision_maker_name || "").trim().split(/\s+/)[0] || null;
}

function companyName(lead) {
  return lead.nome_fantasia || lead.razao_social || "a empresa";
}

function contactPhone(lead) {
  const raw = lead.decision_maker_whatsapp || lead.decision_maker_phone || lead.whatsapp || lead.telefone;
  const digits = String(raw || "").split("@")[0].replace(/\D/g, "");
  if (digits.startsWith("0800")) return null;
  if (digits.length < 10) return null;
  return digits || null;
}

function socialContacts(lead) {
  return {
    instagram: lead.decision_maker_instagram || lead.instagram || null,
    linkedin: lead.decision_maker_linkedin || lead.linkedin || null,
  };
}

function socialLabel(lead) {
  const { instagram, linkedin } = socialContacts(lead);
  return [
    instagram ? `Instagram: ${String(instagram).startsWith("@") ? instagram : `@${instagram}`}` : null,
    linkedin ? `LinkedIn: ${linkedin}` : null,
  ].filter(Boolean).join(" | ");
}

async function ensureTargetSize(lead) {
  let porte = lead.porte || null;
  let capitalSocial = lead.capital_social ?? null;

  if ((!porte && capitalSocial == null) && lead.cnpj) {
    const enriched = await enrichByCnpj(lead.cnpj);
    if (enriched) {
      porte = classifyPorte({
        code: enriched.porteCode,
        text: enriched.porteText,
        mei: enriched.mei,
      });
      capitalSocial = enriched.capitalSocial ?? null;
      await updateCompanyLeadSize(lead.id, { porte, capitalSocial });
    }
  }

  const size = evaluateSize({ porte, capitalSocial });
  return { ...size, porte, capitalSocial };
}

function withOptOut(text) {
  return `${text}\n\nSe preferir não receber mais mensagens, é só responder PARAR.`;
}

function followUpMessage(step, lead) {
  const nome = firstName(lead);
  const greet = nome ? `Oi, ${nome}` : "Oi";
  const empresa = companyName(lead);

  if (step === 1) {
    return `${greet}. Passando só para saber se posso te fazer aquela pergunta rápida sobre a ${empresa}.`;
  }

  return `${greet}. Último toque meu por aqui. Se fizer sentido conversar em outro momento, fico à disposição.`;
}

function outreachMessage(lead) {
  const touchCount = lead.outreach_touch_count ?? 0;
  if (touchCount === 0) {
    const nome = firstName(lead);
    if (nome) {
      return `Oi, ${nome}. Tudo bem? Aqui é a Antonela, da Phosphorcode. Dei uma olhada rápida no trabalho de vocês e uma coisa me deixou curiosa. Posso te perguntar?`;
    }

    return "Oi, tudo bem? Aqui é a Antonela, da Phosphorcode. Dei uma olhada rápida no trabalho de vocês e uma coisa me deixou curiosa. Você sabe quem seria a pessoa certa para eu perguntar?";
  }
  return followUpMessage(touchCount, lead);
}

function nextStatus(touchCountAfterSend) {
  if (touchCountAfterSend >= MAX_TOUCHES) return "done";
  return `contacted_${touchCountAfterSend}`;
}

function isMissingWhatsAppNumberError(err) {
  const message = err?.message || "";
  return /exists"?\s*:\s*false/i.test(message) || /not\s+exists?/i.test(message);
}

function itemLabel(lead, extra = null) {
  const decisor = lead.decision_maker_name ? ` (${lead.decision_maker_name})` : "";
  return `• ${companyName(lead)}${decisor}${extra ? ` — ${extra}` : ""}`;
}

function listLines(items, formatter) {
  const limit = Number(process.env.COMPANY_OUTREACH_SUMMARY_LIMIT ?? 12);
  const lines = items.slice(0, limit).map(formatter);
  if (items.length > limit) lines.push(`• +${items.length - limit} outros`);
  return lines;
}

async function notifyOutreachSummary({ sentLeads, manualLeads, blockedLeads, errorLeads }) {
  if (!sentLeads.length && !manualLeads.length && !blockedLeads.length && !errorLeads.length) return;

  const sections = [
    ["📨 *Resumo do disparo Antonela*"],
    sentLeads.length
      ? ["✅ *Mensagem enviada por WhatsApp:*", ...listLines(sentLeads, ({ lead, phone }) => itemLabel(lead, phone))]
      : null,
    manualLeads.length
      ? ["🔎 *Prospectar manualmente por Instagram/LinkedIn:*", ...listLines(manualLeads, (lead) => itemLabel(lead, socialLabel(lead)))]
      : null,
    blockedLeads.length
      ? ["⏭️ *Não disparados:*", ...listLines(blockedLeads, ({ lead, reason }) => itemLabel(lead, reason))]
      : null,
    errorLeads.length
      ? ["⚠️ *Falha no envio:*", ...listLines(errorLeads, ({ lead, error }) => itemLabel(lead, error))]
      : null,
  ].filter(Boolean);

  await notifyLeadsGroup(sections.map((s) => s.join("\n")).join("\n\n"));
}

export async function runCompanyOutreachTick({ force = false } = {}) {
  if (!prospectingEnabled()) return { sent: 0, skipped: "disabled" };
  if (!force && !isBusinessTime()) return { sent: 0, skipped: "outside_business_hours" };

  const batchSize = Number(process.env.COMPANY_OUTREACH_BATCH_SIZE ?? 10);
  const instance = process.env.EVOLUTION_INSTANCE;
  const leads = await getDueCompanyOutreachLeads(batchSize);
  let sent = 0;
  const sentLeads = [];
  const manualLeads = [];
  const blockedLeads = [];
  const errorLeads = [];

  for (const lead of leads) {
    const phone = contactPhone(lead);
    const socials = socialContacts(lead);

    const size = await ensureTargetSize(lead);
    if (!size.isTarget) {
      await markCompanyOutreachBlocked(lead.id, size.reason);
      blockedLeads.push({ lead, reason: size.reason });
      logger.info(
        { company: companyName(lead), porte: size.porte, capital: size.capitalSocial, motivo: size.reason },
        "⏭️  Company lead bloqueado na cadência por tamanho/porte",
      );
      continue;
    }

    if (!phone) {
      if (socials.instagram || socials.linkedin) {
        await markCompanyOutreachManual(lead.id, "sem WhatsApp/telefone acionável; prospectar por rede social");
        manualLeads.push(lead);
      } else {
        await markCompanyOutreachBlocked(lead.id, "sem WhatsApp, telefone, Instagram ou LinkedIn acionável");
        blockedLeads.push({ lead, reason: "sem contato acionável" });
      }
      continue;
    }

      const text = withOptOut(outreachMessage(lead));
    const touchCount = (lead.outreach_touch_count ?? 0) + 1;
    const status = nextStatus(touchCount);
    const nextOutreachAt = status === "done" ? null : nextCompanyOutreachAt(new Date()).toISOString();

    try {
      await sendWhatsAppMessage({ phone, text, instance });

      const history = await getHistory(phone);
      history.push({ role: "assistant", content: text });
      await saveHistory(phone, history);

      await markCompanyOutreachSent(lead.id, { status, nextOutreachAt, touchCount });
      sent += 1;
      sentLeads.push({ lead, phone });
      logger.info({ phone, company: companyName(lead), touchCount, status }, "📤 Company lead contatado");
    } catch (err) {
      if (isMissingWhatsAppNumberError(err)) {
        if (socials.instagram || socials.linkedin) {
          await markCompanyOutreachManual(lead.id, "WhatsApp não encontrado; prospectar por rede social");
          manualLeads.push(lead);
        } else {
          await markCompanyOutreachBlocked(lead.id, "WhatsApp não encontrado e sem rede social acionável");
          blockedLeads.push({ lead, reason: "WhatsApp não encontrado" });
        }
        logger.warn({ err, phone, company: companyName(lead) }, "⚠️ Número sem WhatsApp para company_lead");
        continue;
      }

      await markCompanyOutreachError(lead.id, err.message);
      errorLeads.push({ lead, error: err.message });
      logger.error({ err, phone, company: companyName(lead) }, "❌ Falha no disparo para company_lead");
    }
  }

  await notifyOutreachSummary({ sentLeads, manualLeads, blockedLeads, errorLeads });

  return {
    sent,
    considered: leads.length,
    manual: manualLeads.length,
    blocked: blockedLeads.length,
    errors: errorLeads.length,
  };
}

export async function checkCompanyOutreachReply({ phone, text, instance }) {
  if (!prospectingEnabled()) return { handled: false };

  const lead = await findActiveCompanyLeadByPhone(phone);
  if (!lead) return { handled: false };

  if (OPT_OUT_RE.test(text)) {
    await markCompanyLeadOptedOut(phone);
    await sendWhatsAppMessage({
      phone,
      instance,
      text: "Combinado, não vou te enviar mais mensagens. Se precisar de algo, é só chamar.",
    });
    logger.info({ phone }, "🚫 Company lead optou por sair");
    return { handled: true };
  }

  await markCompanyLeadReplied(phone);
  logger.info({ phone }, "💬 Company lead respondeu, cadência encerrada");
  return { handled: false };
}
