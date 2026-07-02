import { sendWhatsAppMessage } from "./evolution.js";
import { getHistory, saveHistory } from "./history.js";
import { logger } from "./logger.js";
import {
  prospectingEnabled,
  getDueLeads,
  markTouchSent,
  findActiveLeadByPhone,
  markReplied,
  markOptedOut,
} from "./supabase.js";

const OPT_OUT_RE = /\b(parar|para\s+de\s+enviar|sair|remov[ae]|descadastr\w*|n[aã]o\s+perturbe|n[aã]o\s+quero)\b/i;

// ── Textos de cada toque da cadência (tom Antonela: sem travessão, calorosa) ──
function buildMessage(step, lead) {
  const firstName = (lead.name || "").trim().split(/\s+/)[0];
  const greet = firstName ? `Oi, ${firstName}` : "Oi";
  const optOut = "Se preferir não receber mais mensagens, é só responder PARAR que eu paro por aqui.";

  if (step === "d0") {
    return `${greet}, tudo bem? Aqui é a Antonela, da Phosphorcode. A gente ajuda empresas de varejo e saúde a organizar melhor a operação com software sob medida. Queria entender rapidinho como está a rotina aí na sua empresa hoje, posso te fazer uma pergunta? ${optOut}`;
  }
  if (step === "d3") {
    return `${greet}, passando de novo por aqui. Sei que a rotina é corrida, mas queria saber se faz sentido pra você entender melhor como a Phosphorcode pode ajudar na sua operação. Tem 2 minutos essa semana? ${optOut}`;
  }
  return `${greet}, essa é minha última mensagem por aqui, prometo. Se em algum momento fizer sentido conversar sobre melhorar a operação da sua empresa, é só me chamar que eu te atendo com prazer. ${optOut}`;
}

const SEQUENCE = {
  pending:      { step: "d0", nextStatus: "contacted_d0", offsetDays: 3 },
  contacted_d0: { step: "d3", nextStatus: "contacted_d3", offsetDays: 4 },
  contacted_d3: { step: "d7", nextStatus: "done",          offsetDays: null },
};

// ── Processa um lote de leads vencidos, enviando o próximo toque da cadência ──
export async function runCadenceTick() {
  if (!prospectingEnabled()) return;

  const batchSize = Number(process.env.PROSPECT_BATCH_SIZE ?? 10);
  const instance = process.env.EVOLUTION_INSTANCE;
  const leads = await getDueLeads(batchSize);

  for (const lead of leads) {
    const plan = SEQUENCE[lead.status];
    if (!plan) continue;

    const text = buildMessage(plan.step, lead);

    try {
      await sendWhatsAppMessage({ phone: lead.phone, text, instance });

      const history = await getHistory(lead.phone);
      history.push({ role: "assistant", content: text });
      await saveHistory(lead.phone, history);

      const nextTouchAt = plan.offsetDays
        ? new Date(Date.now() + plan.offsetDays * 86_400_000).toISOString()
        : null;

      await markTouchSent(lead.id, {
        status: plan.nextStatus,
        nextTouchAt,
        touchCount: (lead.touch_count ?? 0) + 1,
      });

      logger.info({ phone: lead.phone, step: plan.step }, "📤 Toque de prospecção enviado");
    } catch (err) {
      logger.error({ err, phone: lead.phone }, "❌ Falha ao enviar toque de prospecção");
    }
  }
}

// ── Chamado pelo webhook antes da Antonela normal processar a mensagem ────────
// Retorna { handled: true } quando a mensagem já foi tratada aqui (opt-out) e
// o webhook NÃO deve chamar a Antonela. Retorna { handled: false } quando a
// cadência foi encerrada (lead respondeu) mas o atendimento normal deve seguir.
export async function checkProspectReply({ phone, text, instance }) {
  if (!prospectingEnabled()) return { handled: false };

  const lead = await findActiveLeadByPhone(phone);
  if (!lead) return { handled: false };

  if (OPT_OUT_RE.test(text)) {
    await markOptedOut(phone);
    await sendWhatsAppMessage({
      phone,
      instance,
      text: "Combinado, não vou te enviar mais mensagens. Se precisar de algo, é só chamar.",
    });
    logger.info({ phone }, "🚫 Lead de prospecção optou por sair");
    return { handled: true };
  }

  await markReplied(phone);
  logger.info({ phone }, "💬 Lead de prospecção respondeu, cadência encerrada");
  return { handled: false };
}
