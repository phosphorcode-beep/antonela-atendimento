import { sendWhatsAppMessage, pauseBot } from "./evolution.js";
import { clearHistory } from "./history.js";
import { logger } from "./logger.js";
import { notifyTeam } from "./notify.js";

// ── Intenções reconhecidas ────────────────────────────────────────────────────
const INTENTS = ["[AGENDAR]", "[SUPORTE]", "[ESCALAR]", "[LEAD_QUALIFICADO]"];

// ── Detecta intenção na resposta da Antonela ──────────────────────────────────
export function detectIntent(reply) {
  for (const tag of INTENTS) {
    if (reply.startsWith(tag)) {
      return {
        intent: tag.replace(/\[|\]/g, ""), // "AGENDAR", "SUPORTE" etc.
        cleanReply: reply.slice(tag.length).trim(),
      };
    }
  }
  return { intent: null, cleanReply: reply };
}

// ── Executa ação conforme intenção ────────────────────────────────────────────
export async function handleIntent({ intent, phone, name, history, instance }) {
  logger.info({ intent, phone }, "🎯 Intenção detectada");

  switch (intent) {
    case "AGENDAR":
      await handleAgendar({ phone, name, instance });
      break;

    case "SUPORTE":
      await handleSuporte({ phone, name, history, instance });
      break;

    case "ESCALAR":
      await handleEscalar({ phone, name, history, instance });
      break;

    case "LEAD_QUALIFICADO":
      await handleLeadQualificado({ phone, name, history });
      break;
  }
}

// ── AGENDAR: envia link de calendário ────────────────────────────────────────
async function handleAgendar({ phone, name, instance }) {
  const calLink = process.env.CALENDAR_LINK ?? "https://phosphorcode.com.br/agendar";

  await sendWhatsAppMessage({
    phone,
    instance,
    text: `Perfeito. Aqui está o link para escolher o melhor horário com nosso time técnico:\n\n📅 ${calLink}\n\nQualquer dúvida antes da conversa, estou aqui.`,
  });

  await notifyTeam({
    type: "AGENDAMENTO",
    phone,
    name,
    message: `${name} solicitou agendamento via WhatsApp.`,
  });
}

// ── SUPORTE: cria ticket e notifica time ─────────────────────────────────────
async function handleSuporte({ phone, name, history, instance }) {
  // Extrai as últimas mensagens como resumo do problema
  const lastMsgs = history
    .slice(-6)
    .map((m) => `[${m.role === "user" ? name : "Antonela"}] ${m.content}`)
    .join("\n");

  await notifyTeam({
    type: "SUPORTE",
    phone,
    name,
    message: `Ticket de suporte aberto:\n\n${lastMsgs}`,
  });

  await sendWhatsAppMessage({
    phone,
    instance,
    text: "Registrei seu chamado. Nosso time técnico vai retornar em breve com uma solução. Você receberá o contato por aqui.",
  });
}

// ── ESCALAR: pausa bot e avisa time ──────────────────────────────────────────
async function handleEscalar({ phone, name, history, instance }) {
  const lastMsgs = history
    .slice(-8)
    .map((m) => `[${m.role === "user" ? name : "Antonela"}] ${m.content}`)
    .join("\n");

  await pauseBot({ phone });
  await clearHistory(phone);

  await notifyTeam({
    type: "ESCALADA",
    phone,
    name,
    message: `${name} pediu atendimento humano. Bot pausado.\n\nContexto:\n${lastMsgs}`,
  });

  logger.info({ phone }, "🧑 Bot pausado — atendimento humano acionado");
}

// ── LEAD_QUALIFICADO: salva lead no CRM/planilha ─────────────────────────────
async function handleLeadQualificado({ phone, name, history }) {
  // Extrai dados do histórico para o CRM
  const context = history
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  await notifyTeam({
    type: "LEAD_QUALIFICADO",
    phone,
    name,
    message: `Novo lead qualificado!\n\nNome: ${name}\nTelefone: ${phone}\nContexto: ${context.slice(0, 500)}`,
  });

  logger.info({ phone, name }, "🎉 Lead qualificado registrado");
}
