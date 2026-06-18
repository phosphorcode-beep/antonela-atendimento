import express from "express";
import "dotenv/config";
import { handleIncomingMessage } from "./antonela.js";
import { isPaused } from "./history.js";
import { logger } from "./logger.js";

// ── Validação de variáveis obrigatórias na inicialização ──────────────────────
const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error({ missing }, "❌ Variáveis de ambiente obrigatórias não definidas. Configure o .env e reinicie.");
  process.exit(1);
}

const app = express();
app.use(express.json());

// ── Deduplicação de mensagens ─────────────────────────────────────────────────
// Evolution API pode reenviar o mesmo evento em caso de timeout. Guardamos os
// IDs das últimas 500 mensagens processadas para descartar duplicatas.
const processedIds = new Set();
const MAX_DEDUP_SIZE = 500;

function markProcessed(id) {
  processedIds.add(id);
  if (processedIds.size > MAX_DEDUP_SIZE) {
    // Remove o mais antigo (primeiro inserido)
    processedIds.delete(processedIds.values().next().value);
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: "Antonela · Phosphorcode", ts: new Date().toISOString() });
});

// ── Webhook principal da Evolution API ───────────────────────────────────────
app.post("/webhook/evolution", async (req, res) => {
  // Responde 200 imediatamente para a Evolution API não reenviar
  res.sendStatus(200);

  try {
    const payload = req.body;

    // Ignora eventos que não são mensagens de texto
    if (payload.event !== "messages.upsert") return;

    const msg = payload.data?.message;
    if (!msg) return;

    // Ignora mensagens enviadas pelo próprio bot
    if (msg.key?.fromMe) return;

    // Ignora mensagens de grupos (opcional — remova se quiser atender grupos)
    if (msg.key?.remoteJid?.includes("@g.us")) return;

    const msgId = msg.key?.id;
    if (msgId) {
      if (processedIds.has(msgId)) {
        logger.debug({ msgId }, "Mensagem duplicada ignorada");
        return;
      }
      markProcessed(msgId);
    }

    const phone = msg.key.remoteJid; // ex: 5561999999999@s.whatsapp.net
    const name  = msg.pushName ?? "Lead";
    const text  = msg.message?.conversation
               ?? msg.message?.extendedTextMessage?.text
               ?? null;

    if (!text) return; // Ignora áudio, imagem etc. (adicione handlers se precisar)

    // Não processa se o atendimento humano estiver ativo para este contato
    if (await isPaused(phone)) {
      logger.debug({ phone }, "Bot pausado — mensagem ignorada (atendimento humano ativo)");
      return;
    }

    logger.info({ phone, name, text }, "📩 Mensagem recebida");

    await handleIncomingMessage({ phone, name, text, instance: payload.instance });
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
  setTimeout(() => process.exit(1), 5000).unref(); // força saída após 5s
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
