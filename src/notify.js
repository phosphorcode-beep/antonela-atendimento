import { logger } from "./logger.js";

// ── Notifica o time da Phosphorcode ───────────────────────────────────────────
// Suporta: webhook genérico, Slack, ou apenas log (para desenvolvimento)
export async function notifyTeam({ type, phone, name, message }) {
  const payload = {
    type,
    phone,
    name,
    message,
    ts: new Date().toISOString(),
  };

  logger.info(payload, `📣 Notificação [${type}]`);

  // ── Webhook genérico (N8N, Make, Zapier etc.) ────────────────────────────
  if (process.env.NOTIFY_WEBHOOK_URL) {
    await sendWebhook(process.env.NOTIFY_WEBHOOK_URL, payload);
  }

  // ── Slack ────────────────────────────────────────────────────────────────
  if (process.env.SLACK_WEBHOOK_URL) {
    await sendSlack(payload);
  }

  // ── WhatsApp do time (via Evolution API) ─────────────────────────────────
  if (process.env.TEAM_PHONE && process.env.EVOLUTION_API_URL) {
    await notifyViaWhatsApp(payload);
  }
}

// ── Envia para webhook genérico ───────────────────────────────────────────────
async function sendWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.debug("Webhook de notificação enviado");
  } catch (err) {
    logger.error({ err }, "Falha no webhook de notificação");
  }
}

// ── Formata e envia para Slack ────────────────────────────────────────────────
async function sendSlack({ type, phone, name, message }) {
  const emoji = {
    AGENDAMENTO:      "📅",
    SUPORTE:          "🔧",
    ESCALADA:         "🚨",
    LEAD_QUALIFICADO: "🎉",
  }[type] ?? "📣";

  const body = {
    text: `${emoji} *[${type}]* — ${name} (${phone})`,
    attachments: [
      {
        color: type === "ESCALADA" ? "#b4452f" : "#556B2F",
        text: message,
        footer: "Antonela · Phosphorcode",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.debug("Slack notificado");
  } catch (err) {
    logger.error({ err }, "Falha ao notificar Slack");
  }
}

// ── Notifica via WhatsApp do próprio time ─────────────────────────────────────
async function notifyViaWhatsApp({ type, phone, name, message }) {
  const text = `🤖 *Antonela · ${type}*\n\n👤 ${name}\n📱 ${phone}\n\n${message}`;

  try {
    await fetch(`${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number: process.env.TEAM_PHONE, text }),
    });
    logger.debug("Time notificado via WhatsApp");
  } catch (err) {
    logger.error({ err }, "Falha ao notificar time via WhatsApp");
  }
}
