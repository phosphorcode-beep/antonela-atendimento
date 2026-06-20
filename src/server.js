import express from "express";
import "dotenv/config";
import { handleIncomingMessage, handleSiteForm } from "./antonela.js";
import { isPaused } from "./history.js";
import { resumeBot } from "./evolution.js";
import { resolveIncomingMedia } from "./media.js";
import { logger } from "./logger.js";

// ── Validação de variáveis obrigatórias ───────────────────────────────────────
const REQUIRED_ENV = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error({ missing }, "❌ Variáveis de ambiente obrigatórias não definidas. Configure o .env e reinicie.");
  process.exit(1);
}

const LLM_KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];
if (!LLM_KEYS.some((k) => process.env[k])) {
  logger.error({ tried: LLM_KEYS }, "❌ Nenhuma chave de LLM definida. Defina GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY.");
  process.exit(1);
}

const ADMIN_KEY    = process.env.ADMIN_KEY;           // para /admin/*
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;   // opcional — configurar na Evolution API

const app = express();
app.use(express.json());

// ── Deduplicação de mensagens ─────────────────────────────────────────────────
const processedIds = new Set();
const MAX_DEDUP_SIZE = 500;

function markProcessed(id) {
  processedIds.add(id);
  if (processedIds.size > MAX_DEDUP_SIZE) {
    processedIds.delete(processedIds.values().next().value);
  }
}

// ── Rate limiting por telefone ────────────────────────────────────────────────
// Máximo de 10 mensagens por minuto por contato
const rateCounts = new Map(); // phone → { count, resetAt }
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(phone) {
  const now = Date.now();
  const entry = rateCounts.get(phone);

  if (!entry || now > entry.resetAt) {
    rateCounts.set(phone, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT) return true;

  return false;
}

// Limpa entradas expiradas a cada 5 minutos para não vazar memória
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of rateCounts) {
    if (now > entry.resetAt) rateCounts.delete(phone);
  }
}, 5 * 60_000).unref();

// ── Lock de concorrência por telefone ─────────────────────────────────────────
// Garante que mensagens do mesmo contato sejam processadas em fila,
// evitando race condition no histórico quando chegam rápido demais.
const phoneLocks = new Map(); // phone → Promise

async function withPhoneLock(phone, fn) {
  const prev = phoneLocks.get(phone) ?? Promise.resolve();
  let resolve;
  const next = new Promise((r) => { resolve = r; });
  phoneLocks.set(phone, next);

  try {
    await prev;
    return await fn();
  } finally {
    resolve();
    // Limpa entrada se ainda aponta para esta promise
    if (phoneLocks.get(phone) === next) phoneLocks.delete(phone);
  }
}

// ── Auth de admin ─────────────────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: "ADMIN_KEY não configurada" });
  }
  const provided = req.headers["x-admin-key"] ?? req.query.key;
  if (provided !== ADMIN_KEY) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: "Antonela · Phosphorcode", ts: new Date().toISOString() });
});

// ── Retomar bot (time aciona após atendimento humano) ─────────────────────────
app.post("/admin/resume", requireAdminKey, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone obrigatório" });

  await resumeBot({ phone });
  logger.info({ phone }, "▶️  Bot retomado via admin");
  res.json({ ok: true, phone });
});

// ── Formulário do site (envio automático) ────────────────────────────────────
const FORM_SECRET = process.env.FORM_SECRET;

app.post("/webhook/form", async (req, res) => {
  if (FORM_SECRET) {
    if (req.headers["x-form-secret"] !== FORM_SECRET) {
      logger.warn({ ip: req.ip }, "Form com segredo inválido rejeitado");
      return res.sendStatus(401);
    }
  }
  res.json({ ok: true });

  try {
    const { nome, empresa, email, telefone, funcionarios, mensagem } = req.body ?? {};
    await handleSiteForm({ nome, empresa, email, telefone, funcionarios, mensagem });
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook do formulário");
  }
});

// ── Webhook principal da Evolution API ───────────────────────────────────────
app.post("/webhook/evolution", async (req, res) => {
  // Valida assinatura se WEBHOOK_SECRET estiver configurado
  if (WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"] ?? req.headers["authorization"];
    if (provided !== WEBHOOK_SECRET) {
      logger.warn({ ip: req.ip }, "Webhook com assinatura inválida rejeitado");
      return res.sendStatus(401);
    }
  }

  // Responde 200 imediatamente para a Evolution API não reenviar
  res.sendStatus(200);

  try {
    const payload = req.body;

    if (payload.event !== "messages.upsert") return;

    const msg = payload.data;
    if (!msg) return;

    if (msg.key?.fromMe) return;
    if (msg.key?.remoteJid?.includes("@g.us")) return;

    const msgId = msg.key?.id;
    if (msgId) {
      if (processedIds.has(msgId)) {
        logger.debug({ msgId }, "Mensagem duplicada ignorada");
        return;
      }
      markProcessed(msgId);
    }

    const phone = msg.key.remoteJid;
    const name  = msg.pushName ?? "Lead";

    if (await isPaused(phone)) {
      logger.debug({ phone }, "Bot pausado, mensagem ignorada (atendimento humano ativo)");
      return;
    }

    if (isRateLimited(phone)) {
      logger.warn({ phone }, "Rate limit atingido, mensagem ignorada");
      return;
    }

    // Texto direto ou conteúdo de mídia (áudio, imagem, figurinha, vídeo)
    let text = msg.message?.conversation
            ?? msg.message?.extendedTextMessage?.text
            ?? null;

    if (!text) {
      text = await resolveIncomingMedia({ data: msg, instance: payload.instance });
    }

    if (!text) return;

    logger.info({ phone, name, text }, "📩 Mensagem recebida");

    await withPhoneLock(phone, () =>
      handleIncomingMessage({ phone, name, text, instance: payload.instance })
    );
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook");
  }
});

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
const server = app.listen(PORT, () => {
  logger.info(`🚀 Antonela ouvindo na porta ${PORT}`);
});

// ── Graceful shutdown (PM2 / Docker) ─────────────────────────────────────────
function shutdown(signal) {
  logger.info(`${signal} recebido — encerrando graciosamente`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
