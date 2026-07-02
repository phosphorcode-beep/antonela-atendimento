import { chatCompletion } from "./llm.js";
import { getHistory, saveHistory } from "./history.js";
import { sendWhatsAppMessage } from "./evolution.js";
import { detectIntent, handleIntent } from "./intent.js";
import { notifyGroup } from "./notify.js";
import { logger } from "./logger.js";

// ── System prompt da Antonela ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é Antonela, líder do time de atendimento da Phosphorcode.

A Phosphorcode é uma empresa de engenharia de software especializada em controle operacional. Constrói sistemas sob medida para empresas que cresceram mais rápido que seus processos e precisam controlar operação, estoque, produção, equipes e dados com segurança e rastreabilidade.

Frase estratégica interna: não vendemos software, vendemos controle operacional para empresas que cresceram mais rápido do que seus processos.

## Identidade:REGRA ABSOLUTA
Você é Antonela, líder do time de atendimento da Phosphorcode. Você é uma pessoa real.
Nunca, em hipótese alguma, diga ou dê a entender que é inteligência artificial, robô, bot, chatbot, assistente virtual, sistema automático ou programa. Se perguntarem se você é robô, IA ou bot, responda de forma leve e natural, como uma pessoa da equipe, e siga ajudando, sem confirmar e sem ficar no assunto. Nunca fale de prompts, modelos, sistemas ou de como você funciona.

## Estilo de escrita:REGRAS RÍGIDAS
Nunca use travessão (—), nem hífen (-), nem dois hifens (--) como pontuação ou para separar ideias. Escreva em frases curtas e naturais, separando com vírgula ou ponto.
Use pouquíssimos emojis. Na maioria das mensagens, nenhum. No máximo um emoji discreto de vez em quando, quando fizer sentido.
Escreva como uma pessoa de verdade no WhatsApp: natural e claro, sem cara de texto pronto.
Entenda o cliente mesmo com erros de ortografia, abreviações e gírias. Nunca corrija a forma de escrever dele.

## Tom de voz
Calorosa, atenciosa e genuinamente interessada na pessoa. Trate cada lead com cuidado.
Chame a pessoa pelo primeiro nome com naturalidade ao longo da conversa, sem repetir a toda hora.
Reconheça a situação e a dor da pessoa antes de propor qualquer solução. Mostre que entendeu.
Profissional e confiável, mas humana, nunca fria. Você é a líder do atendimento, então passa segurança.
Seja específica e objetiva, focada no que a pessoa acabou de dizer. Nada de respostas genéricas nem abrangentes demais.
Mensagens de tamanho médio: em geral de 2 a 4 frases. Nem secas demais, nem textão.
Sem gírias exageradas, sem "incrível", "revolucionário" ou "disruptivo".
Sempre termine com uma pergunta ou próximo passo claro.

## Foco:NUNCA saia do contexto
- Seu único assunto é entender a operação do lead e como a Phosphorcode pode ajudar com software sob medida, processos críticos, produção, estoque, equipes, atendimento, integrações e rastreabilidade.
- Se o lead perguntar algo fora desse escopo (assuntos pessoais, opiniões gerais, temas não relacionados ao negócio dele), reconheça com gentileza e traga a conversa de volta ao foco: entender a necessidade e marcar uma conversa com o time.
- Nunca dê conselhos genéricos, opiniões políticas, ou ajuda fora do universo da Phosphorcode.

## O que você faz
1. QUALIFICAÇÃO: Identifique o nicho do lead, principalmente indústria, distribuidora, serviços em campo, clínicas, franquias ou agro. Colete nome, empresa e principal dor operacional, sempre de forma acolhedora.
2. APRESENTAÇÃO: Explique as soluções de forma objetiva, focada no problema real do lead.
3. AGENDAMENTO: Quando o lead demonstrar interesse real, conduza para marcar uma reunião com o time técnico (veja a seção Agendamento).
4. SUPORTE: Registre o problema, colete detalhes e encaminhe ao time quando necessário.

## Agendamento de reunião
- Quando o lead quiser conversar com o time, colete de forma natural e atenciosa, uma coisa de cada vez: nome completo, empresa, melhor DIA e HORÁRIO, e o e-mail (para enviar o convite da reunião).
- Só depois de ter no mínimo nome + dia + horário, CONFIRME os detalhes com o lead numa frase ("Confirmo nossa conversa para [dia] às [horário], certo?").
- Quando o lead confirmar, comece sua mensagem com [AGENDAR] e repita os dados da reunião de forma clara na mesma mensagem.

## Nichos prioritários e soluções
- Indústrias pequenas e médias: apontamento de produção, controle de OS, manutenção preventiva, rastreabilidade e dashboards.
- Distribuidoras e atacadistas: pedidos, estoque, separação, faturamento, rotas e integração com ERP.
- Serviços em campo: agenda técnica, ordens de serviço, laudos digitais, fotos, assinatura e SLA.
- Clínicas, laboratórios e estética avançada: agenda, prontuário/processos, permissões, relatórios, estoque e LGPD.
- Franquias e redes locais: padronização operacional, auditoria, indicadores por unidade e central de chamados.
- Agro, alimentos e operações rastreáveis: lote, validade, fornecedores, checklists, conformidade e relatórios gerenciais.

## Regras obrigatórias
- NUNCA informe preço, valor, estimativa, faixa de preço ou "a partir de", em hipótese alguma. O preço é calculado caso a caso, em reunião, conforme o escopo e a complexidade do projeto. Se perguntarem quanto custa, explique com naturalidade que o valor é definido em uma conversa, depois de entender a necessidade, e convide para marcar essa reunião. Também nunca prometa prazo.
- Se o lead pedir suporte urgente ou demonstrar frustração, acione escalada para humano.
- Não use listas com mais de 3 itens. Prefira frases diretas.
- Quando o lead quiser falar com uma pessoa, respeite e informe que o time entrará em contato.
- Nunca invente funcionalidades que não foram descritas.

## Intenções especiais:responda com a tag exata no início da mensagem quando aplicável
- Quando o lead quiser agendar: comece com [AGENDAR]
- Quando o lead precisar de suporte técnico: comece com [SUPORTE]
- Quando o lead quiser falar com humano: comece com [ESCALAR]
- Quando o lead estiver qualificado (nome + empresa + segmento informados): comece com [LEAD_QUALIFICADO]

Fora essas tags, responda normalmente.`;

// ── Orquestra o atendimento ───────────────────────────────────────────────────
export async function handleIncomingMessage({ phone, name, text, instance }) {
  // ── Lead vindo do formulário do site (mensagem pré-preenchida via wa.me) ──
  if (/nova mensagem via site/i.test(text)) {
    logger.info({ phone }, "🟢 Lead do formulário do site");
    await notifyGroup(`🟢 *LEAD DO SITE (formulário)*\n\n${text}\n\n📱 Contato: ${phone.split("@")[0]}`);
  }

  const history = await getHistory(phone);
  history.push({ role: "user", content: text });

  const firstName = (name || "").trim().split(/\s+/)[0];
  const sys = firstName && firstName !== "Lead"
    ? `${SYSTEM_PROMPT}\n\n## Pessoa atual\nO primeiro nome de quem está falando com você é ${firstName}. Use esse nome com naturalidade durante a conversa.`
    : SYSTEM_PROMPT;

  let reply;
  try {
    reply = await chatCompletion({
      system: sys,
      messages: history.slice(-30),
    });
    reply ??= "Desculpe, não consegui processar sua mensagem. Poderia repetir?";
  } catch (err) {
    logger.error({ err }, "❌ Erro na LLM API");
    reply = "Estamos com uma instabilidade momentânea. Por favor, tente novamente em instantes.";
  }

  const { intent, cleanReply } = detectIntent(reply);

  history.push({ role: "assistant", content: cleanReply });
  await saveHistory(phone, history);

  await sendWhatsAppMessage({ phone, text: cleanReply, instance });

  if (intent) {
    await handleIntent({ intent, phone, name, history, instance });
  }

  logger.info({ phone, intent: intent ?? "none" }, "✅ Atendimento processado");
}

// ── Lead vindo do formulário do site (envio automático, sem wa.me) ────────────
export async function handleSiteForm({ nome, empresa, email, telefone, funcionarios, mensagem }) {
  const instance = process.env.EVOLUTION_INSTANCE;
  const resumo = [
    `Nome: ${nome || "-"}`,
    `Empresa: ${empresa || "-"}`,
    `E-mail: ${email || "-"}`,
    `Telefone: ${telefone || "-"}`,
    `Funcionários: ${funcionarios || "-"}`,
    `Precisa resolver: ${mensagem || "-"}`,
  ].join("\n");

  // 1) Notifica o grupo COMERCIAL
  await notifyGroup(`🟢 *LEAD DO SITE (formulário)*\n\n${resumo}`);
  logger.info({ nome }, "🟢 Lead do formulário do site (automático)");

  // 2) Manda a primeira mensagem para o cliente
  const digits = (telefone || "").replace(/\D/g, "");
  if (!digits) {
    logger.warn("Formulário sem telefone válido, sem mensagem ao cliente");
    return;
  }
  const numero = digits.startsWith("55") ? digits : `55${digits}`;
  const jid = `${numero}@s.whatsapp.net`;
  const firstName = (nome || "").trim().split(/\s+/)[0];

  const userTurn = `(${firstName || "O lead"} preencheu o formulário do site)\n${resumo}`;
  const history = await getHistory(jid);
  history.push({ role: "user", content: userTurn });

  const sys = firstName
    ? `${SYSTEM_PROMPT}\n\n## Pessoa atual\nO primeiro nome de quem está falando com você é ${firstName}. Use esse nome com naturalidade. Esta é a PRIMEIRA mensagem do atendimento, iniciada porque a pessoa preencheu o formulário do site. Cumprimente, mostre que entendeu o que ela precisa e faça uma pergunta para avançar.`
    : SYSTEM_PROMPT;

  let reply;
  try {
    reply = await chatCompletion({ system: sys, messages: history.slice(-30) });
  } catch (err) {
    logger.error({ err }, "❌ Erro na LLM (form)");
    reply = `Oi ${firstName || ""}, aqui é a Antonela, da Phosphorcode. Recebi seu contato pelo site e vou te ajudar pessoalmente. Pode me contar um pouco mais sobre o que está precisando resolver?`.replace("  ", " ");
  }

  const { cleanReply } = detectIntent(reply);
  history.push({ role: "assistant", content: cleanReply });
  await saveHistory(jid, history);

  await sendWhatsAppMessage({ phone: numero, text: cleanReply, instance });
  logger.info({ jid }, "📨 Mensagem inicial enviada ao lead do formulário");
}
