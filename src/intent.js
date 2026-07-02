import { sendWhatsAppMessage, pauseBot } from "./evolution.js";
import { clearHistory } from "./history.js";
import { logger } from "./logger.js";
import { notifyTeam, notifyGroup } from "./notify.js";
import { chatCompletion } from "./llm.js";
import { calendarEnabled, createMeeting, TZ } from "./calendar.js";
import { classifyNiche, getNicheProfile } from "./niches.js";
import { prospectingEnabled, upsertInboundLead } from "./supabase.js";

// ── Intenções reconhecidas ────────────────────────────────────────────────────
const INTENTS = ["[AGENDAR]", "[SUPORTE]", "[ESCALAR]", "[LEAD_QUALIFICADO]"];

// ── Detecta intenção na resposta da Antonela ──────────────────────────────────
export function detectIntent(reply) {
  for (const tag of INTENTS) {
    if (reply.includes(tag)) {
      // Remove a tag de qualquer posição (início, meio ou fim) e limpa espaços
      let cleanReply = reply
        .split(tag).join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ *\n/g, "\n")
        .trim();

      if (!cleanReply) {
        cleanReply = "Perfeito, já estou cuidando disso para você.";
      }

      return {
        intent: tag.replace(/\[|\]/g, ""), // "AGENDAR", "SUPORTE" etc.
        cleanReply,
      };
    }
  }
  return { intent: null, cleanReply: reply };
}

// ── Executa ação conforme intenção ────────────────────────────────────────────
export async function handleIntent({ intent, phone, name, history, instance }) {
  logger.info({ intent, phone }, "🎯 Intenção detectada");

  switch (intent) {
    case "AGENDAR":
      await handleAgendar({ phone, name, history, instance });
      break;

    case "SUPORTE":
      await handleSuporte({ phone, name, history, instance });
      break;

    case "ESCALAR":
      await handleEscalar({ phone, name, history, instance });
      break;

    case "LEAD_QUALIFICADO":
      await handleLeadQualificado({ phone, name, history });
      break;
  }
}

// ── AGENDAR: extrai dados, cria evento no Google Calendar e avisa o grupo ──────
async function handleAgendar({ phone, name, history, instance }) {
  const meeting = await extractMeeting({ history, fallbackName: name });
  let eventLink = null;

  if (calendarEnabled() && meeting.datetime) {
    try {
      const desc = [
        `Lead: ${meeting.name || name}`,
        `Empresa: ${meeting.company || "-"}`,
        `Telefone: ${phone.split("@")[0]}`,
        `E-mail: ${meeting.email || "-"}`,
        `Assunto: ${meeting.topic || "-"}`,
        ``,
        `Agendado automaticamente pela Antonela.`,
      ].join("\n");

      const event = await createMeeting({
        title: `Reunião Phosphorcode — ${meeting.name || name}`,
        description: desc,
        startISO: meeting.datetime,
        durationMin: meeting.durationMin || 30,
      });
      eventLink = event.htmlLink;
    } catch (err) {
      logger.error({ err }, "❌ Falha ao criar evento no Google Calendar");
    }
  }

  const quando = formatWhen(meeting.datetime);

  // Confirmação para o lead
  let leadMsg;
  if (eventLink) {
    leadMsg = `Reunião confirmada${quando ? ` para ${quando}` : ""}. Já deixei tudo agendado com nosso time, que vai entrar em contato. Se precisar ajustar qualquer detalhe, é só me falar por aqui.`;
  } else {
    const calLink = process.env.CALENDAR_LINK ?? "https://phosphorcode.com.br/agendar";
    leadMsg = `Perfeito, registrei seu interesse${quando ? ` para ${quando}` : ""} e nosso time vai confirmar com você em instantes. Se preferir já escolher um horário, este é o link: ${calLink}`;
  }
  await sendWhatsAppMessage({ phone, instance, text: leadMsg });

  // Notifica o grupo COMERCIAL
  const groupMsg = [
    `📅 *NOVA REUNIÃO* — Phosphorcode`,
    ``,
    `👤 ${meeting.name || name}`,
    `🏢 ${meeting.company || "-"}`,
    `📱 ${phone.split("@")[0]}`,
    `✉️ ${meeting.email || "-"}`,
    `🗓️ ${quando || "(horário a confirmar)"}`,
    `📝 ${meeting.topic || "-"}`,
    eventLink ? `\n🔗 ${eventLink}` : `\n⚠️ Evento NÃO criado no Calendar — confirmar manualmente.`,
  ].join("\n");
  await notifyGroup(groupMsg);

  // Notificação genérica adicional (webhook/Slack, se configurados)
  await notifyTeam({ type: "AGENDAMENTO", phone, name: meeting.name || name, message: groupMsg });
}

// ── Extrai dados estruturados da reunião a partir da conversa ──────────────────
async function extractMeeting({ history, fallbackName }) {
  const agora = new Date().toLocaleString("sv-SE", { timeZone: TZ });
  const system = `Você extrai dados de agendamento de uma conversa de atendimento.
Hoje é ${agora} (fuso ${TZ}). Resolva expressões como "amanhã", "segunda", "às 15h" para data/hora absolutas.
Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato exato:
{"datetime":"YYYY-MM-DDTHH:mm:ss","durationMin":30,"name":"","company":"","email":"","topic":""}
Regras: use o fuso ${TZ}. Se um campo não foi informado, use "" (e 30 para durationMin). Se não houver data/hora clara, use "" em datetime.`;

  try {
    const raw = await chatCompletion({ system, messages: history.slice(-14) });
    const data = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!data.name) data.name = fallbackName;
    return data;
  } catch (err) {
    logger.error({ err }, "Falha ao extrair dados da reunião");
    return { datetime: "", durationMin: 30, name: fallbackName, company: "", email: "", topic: "" };
  }
}

// ── Formata data/hora para pt-BR ──────────────────────────────────────────────
function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// ── SUPORTE: cria ticket e notifica time ─────────────────────────────────────
async function handleSuporte({ phone, name, history, instance }) {
  // Extrai as últimas mensagens como resumo do problema
  const lastMsgs = history
    .slice(-6)
    .map((m) => `[${m.role === "user" ? name : "Antonela"}] ${m.content}`)
    .join("\n");

  await notifyTeam({
    type: "SUPORTE",
    phone,
    name,
    message: `Ticket de suporte aberto:\n\n${lastMsgs}`,
  });

  await sendWhatsAppMessage({
    phone,
    instance,
    text: "Registrei seu chamado. Nosso time técnico vai retornar em breve com uma solução. Você receberá o contato por aqui.",
  });
}

// ── ESCALAR: pausa bot e avisa time ──────────────────────────────────────────
async function handleEscalar({ phone, name, history, instance }) {
  const lastMsgs = history
    .slice(-8)
    .map((m) => `[${m.role === "user" ? name : "Antonela"}] ${m.content}`)
    .join("\n");

  const groupMsg = [
    `🆘 *ATENDIMENTO HUMANO SOLICITADO*`,
    ``,
    `👤 ${name}`,
    `📱 ${phone.split("@")[0]}`,
    ``,
    `O lead pediu para falar com uma pessoa. A Antonela segue na conversa, mas alguém do time pode assumir quando puder.`,
    ``,
    `Contexto:`,
    lastMsgs,
  ].join("\n");
  await notifyGroup(groupMsg);

  await notifyTeam({ type: "ESCALADA", phone, name, message: groupMsg });

  logger.info({ phone }, "🧑 Atendimento humano solicitado (bot continua ativo)");
}

// ── LEAD_QUALIFICADO: extrai dados, persiste no Supabase (dedup por telefone) e
// notifica o grupo comercial + canais do time ────────────────────────────────
async function handleLeadQualificado({ phone, name, history }) {
  const extracted = await extractQualifiedLead({ history, fallbackName: name });
  const profile = extracted.segment ? getNicheProfile(extracted.segment) : null;

  let saved = null;
  if (prospectingEnabled()) {
    saved = await upsertInboundLead({
      phone,
      name: extracted.name || name,
      company: extracted.company || null,
      segment: extracted.segment || null,
      source: "inbound-whatsapp",
      lacunas: buildInboundLacunas(extracted),
    });
  }

  const persistLine = !prospectingEnabled()
    ? `(banco não configurado, só notificação)`
    : saved
      ? `💾 Salvo em company_leads`
      : `⚠️ Falha ao salvar no banco, confirmar manualmente`;

  const message = [
    `🎉 *LEAD QUALIFICADO* — Phosphorcode`,
    ``,
    `👤 ${extracted.name || name}`,
    `🏢 ${extracted.company || "-"}`,
    `📱 ${phone.split("@")[0]}`,
    `🎯 Nicho: ${profile ? profile.label : "não identificado"}`,
    extracted.pain ? `📝 Dor: ${extracted.pain}` : null,
    ``,
    persistLine,
  ].filter((line) => line !== null).join("\n");

  await notifyGroup(message);
  await notifyTeam({ type: "LEAD_QUALIFICADO", phone, name: extracted.name || name, message });

  logger.info(
    { phone, name: extracted.name || name, segment: extracted.segment || null, saved: Boolean(saved) },
    "🎉 Lead qualificado registrado",
  );
}

// ── Extrai nome, empresa, nicho e dor da conversa (JSON via LLM) ──────────────
async function extractQualifiedLead({ history, fallbackName }) {
  const system = `Você extrai dados de qualificação de uma conversa de atendimento comercial.
Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato exato:
{"name":"","company":"","segment":"","pain":""}
Regras:
- "name": primeiro nome ou nome completo da pessoa. "company": nome da empresa dela.
- "segment": classifique em UM destes valores exatos, só quando houver evidência clara: industria, distribuidora, servicos_campo, clinicas, franquias, agro. Sem evidência, use "".
- "pain": principal dor operacional citada, em poucas palavras.
- Qualquer campo sem informação clara = "".`;

  try {
    const raw = await chatCompletion({ system, messages: history.slice(-14) });
    const data = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!data.name) data.name = fallbackName;

    // Se o modelo devolveu um segment fora do enum, tenta reclassificar pelo texto.
    if (data.segment && !getNicheProfile(data.segment)) {
      data.segment = classifyNiche(data.segment)?.segment ?? "";
    }
    return data;
  } catch (err) {
    logger.error({ err }, "Falha ao extrair dados do lead qualificado");
    // Fallback: classifica o nicho a partir do texto do lead, sem depender de JSON.
    const text = history.filter((m) => m.role === "user").map((m) => m.content).join(" ");
    return { name: fallbackName, company: "", segment: classifyNiche(text)?.segment ?? "", pain: "" };
  }
}

function buildInboundLacunas(extracted) {
  const lacunas = [];
  if (!extracted.company) lacunas.push("empresa não informada");
  if (!extracted.segment) lacunas.push("nicho não identificado");
  return lacunas.length ? lacunas : null;
}
