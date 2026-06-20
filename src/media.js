import { writeFileSync, createReadStream, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { logger } from "./logger.js";

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const VISION_MODEL  = process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3";

// ── Baixa a mídia da Evolution e devolve base64 + mimetype ────────────────────
async function fetchBase64({ data, instance }) {
  const res = await fetch(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_KEY },
    body: JSON.stringify({ message: { key: data.key }, convertToMp4: false }),
  });
  if (!res.ok) throw new Error(`getBase64 ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { base64: j.base64, mime: j.mimetype || "application/octet-stream" };
}

// ── Transcreve áudio com Groq Whisper ─────────────────────────────────────────
async function transcribeAudio({ base64, mime }) {
  const { default: Groq } = await import("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a"
            : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "ogg";
  const tmp = join(tmpdir(), `aud_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`);
  writeFileSync(tmp, Buffer.from(base64, "base64"));
  try {
    const r = await groq.audio.transcriptions.create({
      file: createReadStream(tmp),
      model: WHISPER_MODEL,
      language: "pt",
      temperature: 0,
    });
    return r.text?.trim() || "";
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ── Descreve imagem/figurinha com modelo de visão da Groq ─────────────────────
async function describeImage({ base64, mime }) {
  const { default: Groq } = await import("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const r = await groq.chat.completions.create({
    model: VISION_MODEL,
    max_tokens: 350,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Descreva de forma objetiva e curta o que aparece nesta imagem, em português. Se houver texto na imagem, transcreva. Contexto: atendimento comercial de uma empresa de software." },
        { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
      ],
    }],
  });
  return r.choices?.[0]?.message?.content?.trim() || "";
}

// ── Resolve uma mensagem de mídia em texto utilizável pela Antonela ────────────
// Retorna a string a ser tratada como mensagem do cliente, ou null se ignorar.
export async function resolveIncomingMedia({ data, instance }) {
  const m = data.message ?? {};

  try {
    // Áudio (mensagem de voz ou arquivo de áudio)
    if (m.audioMessage) {
      const media = await fetchBase64({ data, instance });
      const texto = await transcribeAudio(media);
      if (texto) {
        logger.info({ chars: texto.length }, "🎙️ Áudio transcrito");
        return texto;
      }
      return "(o cliente enviou um áudio, mas não deu para entender o que foi dito)";
    }

    // Imagem
    if (m.imageMessage) {
      const caption = m.imageMessage.caption?.trim();
      const media = await fetchBase64({ data, instance });
      let desc = "";
      try { desc = await describeImage(media); } catch (e) { logger.error({ err: e }, "Falha na visão (imagem)"); }
      logger.info("🖼️ Imagem recebida");
      return [
        "(o cliente enviou uma imagem)",
        caption ? `Legenda: ${caption}` : "",
        desc ? `Conteúdo da imagem: ${desc}` : "",
      ].filter(Boolean).join("\n");
    }

    // Figurinha
    if (m.stickerMessage) {
      let desc = "";
      try {
        const media = await fetchBase64({ data, instance });
        desc = await describeImage(media);
      } catch (e) { logger.error({ err: e }, "Falha na visão (figurinha)"); }
      logger.info("🩷 Figurinha recebida");
      return desc
        ? `(o cliente enviou uma figurinha que representa: ${desc})`
        : "(o cliente enviou uma figurinha)";
    }

    // Vídeo
    if (m.videoMessage) {
      const caption = m.videoMessage.caption?.trim();
      logger.info("🎬 Vídeo recebido");
      return caption
        ? `(o cliente enviou um vídeo com a legenda: ${caption})`
        : "(o cliente enviou um vídeo)";
    }

    // Documento
    if (m.documentMessage) {
      const nome = m.documentMessage.fileName || "arquivo";
      return `(o cliente enviou um documento: ${nome})`;
    }
  } catch (err) {
    logger.error({ err }, "❌ Falha ao processar mídia");
    return "(o cliente enviou um arquivo de mídia que não consegui abrir agora)";
  }

  return null;
}
