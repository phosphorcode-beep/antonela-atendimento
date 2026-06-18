import express from "express";
import "dotenv/config";
import { handleIncomingMessage } from "./antonela.js";
import { logger } from "./logger.js";

const app = express();
app.use(express.json());

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

    const phone   = msg.key.remoteJid;           // ex: 5561999999999@s.whatsapp.net
    const name    = msg.pushName ?? "Lead";
    const text    = msg.message?.conversation
                 ?? msg.message?.extendedTextMessage?.text
                 ?? null;

    if (!text) return; // Ignora áudio, imagem etc. (adicione handlers se precisar)

    logger.info({ phone, name, text }, "📩 Mensagem recebida");

    await handleIncomingMessage({ phone, name, text, instance: payload.instance });
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook");
  }
});

// ── Inicia servidor ───────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Antonela ouvindo na porta ${PORT}`);
});
