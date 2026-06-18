import { logger } from "./logger.js";
import { setPaused } from "./history.js";

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helper base com retry ─────────────────────────────────────────────────────
async function evolutionRequest(path, body, retries = 3) {
  const url = `${EVOLUTION_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_KEY },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    const txt = await res.text();
    const err = new Error(`Evolution API ${res.status}: ${txt}`);

    // Não tenta de novo em erros de cliente (4xx)
    if (res.status >= 400 && res.status < 500) throw err;

    if (attempt < retries) {
      logger.warn({ attempt, status: res.status }, "Evolution API falhou — tentando novamente");
      await sleep(attempt * 1000); // backoff: 1s, 2s
    } else {
      throw err;
    }
  }
}

// ── Envia mensagem de texto ───────────────────────────────────────────────────
export async function sendWhatsAppMessage({ phone, text, instance }) {
  const delay = Math.min(1000 + text.length * 18, 4000);
  await sleep(delay);

  try {
    await evolutionRequest(`/message/sendText/${instance}`, {
      number: phone,
      text,
      options: { delay: 0, presence: "composing" },
    });
    logger.info({ phone, chars: text.length }, "📤 Mensagem enviada");
  } catch (err) {
    logger.error({ err, phone }, "❌ Falha ao enviar mensagem");
    throw err;
  }
}

// ── Pausa o bot (escalada para humano) ───────────────────────────────────────
export async function pauseBot({ phone }) {
  await setPaused(phone, true);
  logger.info({ phone }, "⏸️  Bot pausado — atendimento humano ativo");
}

// ── Retoma o bot ──────────────────────────────────────────────────────────────
export async function resumeBot({ phone }) {
  await setPaused(phone, false);
  logger.info({ phone }, "▶️  Bot retomado");
}

// ── Reação a mensagem (opcional — Evolution API v2+) ──────────────────────────
export async function sendReaction({ phone, messageId, emoji, instance }) {
  try {
    await evolutionRequest(`/message/sendReaction/${instance}`, {
      key: { remoteJid: phone, id: messageId },
      reaction: emoji,
    });
  } catch {
    // Não crítico
  }
}
