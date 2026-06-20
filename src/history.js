import { createClient } from "redis";
import { logger } from "./logger.js";

const HISTORY_TTL = 60 * 60 * 24 * 30; // 30 dias em segundos
const KEY_PREFIX  = "antonela:history:";
const PAUSED_PREFIX = "antonela:paused:";
const PAUSED_TTL = 60 * 60 * 24; // 24h — time tem 1 dia para retomar manualmente

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

  // Mantém no máximo 80 mensagens para economizar memória
  const trimmed = messages.slice(-80);

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

// ── Controle de pausa do bot (atendimento humano ativo) ───────────────────────
export async function setPaused(phone, paused = true) {
  const client = await getRedis();
  const key    = PAUSED_PREFIX + phone;

  try {
    if (client) {
      if (paused) {
        await client.setEx(key, PAUSED_TTL, "1");
      } else {
        await client.del(key);
      }
    } else {
      if (paused) {
        memoryStore.set(key, true);
      } else {
        memoryStore.delete(key);
      }
    }
  } catch (err) {
    logger.error({ err, phone }, "Erro ao atualizar estado de pausa");
  }
}

export async function isPaused(phone) {
  const client = await getRedis();
  const key    = PAUSED_PREFIX + phone;

  try {
    if (client) {
      return (await client.exists(key)) === 1;
    }
    return memoryStore.has(key);
  } catch (err) {
    logger.error({ err, phone }, "Erro ao verificar pausa");
    return false;
  }
}
