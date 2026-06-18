import { createClient } from "redis";
import { logger } from "./logger.js";

const HISTORY_TTL = 60 * 60 * 24 * 3; // 3 dias em segundos
const KEY_PREFIX  = "antonela:history:";

// ── Fallback em memória (para dev sem Redis) ──────────────────────────────────
const memoryStore = new Map();

// ── Conexão Redis ─────────────────────────────────────────────────────────────
let redis = null;

async function getRedis() {
  if (redis) return redis;
  if (!process.env.REDIS_URL) {
    logger.warn("⚠️  REDIS_URL não definido — usando armazenamento em memória (dados perdidos ao reiniciar)");
    return null;
  }

  try {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", (err) => logger.error({ err }, "Redis error"));
    await redis.connect();
    logger.info("✅ Redis conectado");
    return redis;
  } catch (err) {
    logger.error({ err }, "❌ Falha ao conectar Redis — usando memória");
    return null;
  }
}

// ── Busca histórico ───────────────────────────────────────────────────────────
export async function getHistory(phone) {
  const client = await getRedis();
  const key = KEY_PREFIX + phone;

  try {
    if (client) {
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : [];
    }
    return memoryStore.get(key) ?? [];
  } catch (err) {
    logger.error({ err, phone }, "Erro ao buscar histórico");
    return [];
  }
}

// ── Salva histórico ───────────────────────────────────────────────────────────
export async function saveHistory(phone, messages) {
  const client = await getRedis();
  const key    = KEY_PREFIX + phone;

  // Mantém no máximo 40 mensagens para economizar memória
  const trimmed = messages.slice(-40);

  try {
    if (client) {
      await client.setEx(key, HISTORY_TTL, JSON.stringify(trimmed));
    } else {
      memoryStore.set(key, trimmed);
    }
  } catch (err) {
    logger.error({ err, phone }, "Erro ao salvar histórico");
  }
}

// ── Limpa histórico (ex: após escalada para humano) ───────────────────────────
export async function clearHistory(phone) {
  const client = await getRedis();
  const key    = KEY_PREFIX + phone;

  try {
    if (client) {
      await client.del(key);
    } else {
      memoryStore.delete(key);
    }
    logger.info({ phone }, "🗑️  Histórico limpo");
  } catch (err) {
    logger.error({ err, phone }, "Erro ao limpar histórico");
  }
}
