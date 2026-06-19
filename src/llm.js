import { logger } from "./logger.js";

// ── Detecta provider disponível se LLM_PROVIDER não estiver definido ──────────
function resolveProvider() {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit) return explicit;
  if (process.env.GROQ_API_KEY)    return "groq";
  if (process.env.GEMINI_API_KEY)  return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("Nenhuma chave de LLM encontrada. Defina GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY.");
}

// ── Groq (Llama 3.3 70B) ──────────────────────────────────────────────────────
async function groqChat({ system, messages }) {
  const { default: Groq } = await import("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const res = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    max_tokens: 1024,
    messages: [{ role: "system", content: system }, ...messages],
  });

  return res.choices[0].message.content;
}

// ── Gemini (1.5 Flash) ────────────────────────────────────────────────────────
async function geminiChat({ system, messages }) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const model = genai.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
    systemInstruction: system,
  });

  // Gemini usa "model" em vez de "assistant" e parts em vez de content
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastUserMsg = messages.at(-1).content;
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastUserMsg);

  return result.response.text();
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────
async function anthropicChat({ system, messages }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    messages,
  });

  return res.content[0]?.text;
}

// ── Interface pública ─────────────────────────────────────────────────────────
export async function chatCompletion({ system, messages }) {
  const provider = resolveProvider();
  logger.debug({ provider }, "LLM provider");

  switch (provider) {
    case "groq":      return groqChat({ system, messages });
    case "gemini":    return geminiChat({ system, messages });
    case "anthropic": return anthropicChat({ system, messages });
    default: throw new Error(`LLM_PROVIDER inválido: "${provider}". Use groq, gemini ou anthropic.`);
  }
}
