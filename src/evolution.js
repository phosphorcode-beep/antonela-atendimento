import { logger } from "./logger.js";

const EVOLUTION_URL  = process.env.EVOLUTION_API_URL;   // ex: https://minha-evolution.com
const EVOLUTION_KEY  = process.env.EVOLUTION_API_KEY;   // sua API Key

// ── Helper base para chamadas à Evolution API ─────────────────────────────────
async function evolutionRequest(path, body) {
  const url = `${EVOLUTION_URL}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": EVOLUTION_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Evolution API ${res.status}: ${txt}`);
  }

  return res.json();
}

// ── Envia mensagem de texto ───────────────────────────────────────────────────
export async function sendWhatsAppMessage({ phone, text, instance }) {
  // Simula delay de digitação humana (1-3s dependendo do tamanho da resposta)
  const delay = Math.min(1000 + text.length * 18, 4000);
  await sleep(delay);

  try {
    await evolutionRequest(`/message/sendText/${instance}`, {
      number: phone,
      text,
      options: {
        delay: 0,         // já fizemos o delay acima
        presence: "composing",
      },
    });
    logger.info({ phone, chars: text.length }, "📤 Mensagem enviada");
  } catch (err) {
    logger.error({ err, phone }, "❌ Falha ao enviar mensagem");
    throw err;
  }
}

// ── Pausa o bot para um número (escalada para humano) ─────────────────────────
export async function pauseBot({ phone, instance, minutes = 60 }) {
  try {
    // Evolution API v2: endpoint para ignorar contato por N minutos
    await evolutionRequest(`/chatwoot/ignore/${instance}`, {
      number: phone,
      ignore: true,
    });
    logger.info({ phone, minutes }, "⏸️  Bot pausado");
  } catch (err) {
    // Se o endpoint não existir na sua versão, logue e continue
    logger.warn({ err }, "Endpoint de pausa não disponível — implemente via flag no Redis");
  }
}

// ── Retoma o bot ──────────────────────────────────────────────────────────────
export async function resumeBot({ phone, instance }) {
  try {
    await evolutionRequest(`/chatwoot/ignore/${instance}`, {
      number: phone,
      ignore: false,
    });
    logger.info({ phone }, "▶️  Bot retomado");
  } catch (err) {
    logger.warn({ err }, "Endpoint de retomada não disponível");
  }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
