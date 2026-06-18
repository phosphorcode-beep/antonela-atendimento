# Antonela · Agente de Atendimento WhatsApp
### Phosphorcode — Engenharia de Software

Agente de IA para atendimento no WhatsApp. Qualifica leads, apresenta soluções, agenda reuniões e aciona suporte — tudo alinhado ao tom de voz da Phosphorcode.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | Node.js 20+ (ESM) |
| IA | Claude Sonnet via Anthropic API |
| WhatsApp | Evolution API v2 |
| Histórico | Redis (fallback em memória) |
| Logs | Pino (JSON estruturado) |
| Notificações | Webhook / Slack / WhatsApp do time |

---

## Arquitetura

```
WhatsApp
  └── Evolution API
        └── POST /webhook/evolution
              └── server.js
                    └── antonela.js
                          ├── history.js   (Redis)
                          ├── Claude API   (Anthropic)
                          ├── intent.js    (detecta ação)
                          ├── evolution.js (envia resposta)
                          └── notify.js    (avisa o time)
```

---

## Instalação

### 1. Pré-requisitos

- Node.js 20+
- Redis (opcional — sem ele usa memória)
- Evolution API instalada e com instância ativa
- API Key da Anthropic

### 2. Clone e instale

```bash
git clone https://github.com/phosphorcode/antonela
cd antonela
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp .env.example .env
# edite o .env com seus valores
```

Campos obrigatórios:

```env
ANTHROPIC_API_KEY=sk-ant-...
EVOLUTION_API_URL=https://sua-evolution.com
EVOLUTION_API_KEY=sua-api-key
EVOLUTION_INSTANCE=phosphorcode
```

### 4. Inicie o servidor

```bash
# desenvolvimento (com hot-reload)
npm run dev

# produção
npm start
```

---

## Configuração da Evolution API

### 1. Criar instância

No painel da Evolution API ou via API:

```http
POST /instance/create
Content-Type: application/json
apikey: SUA_API_KEY

{
  "instanceName": "phosphorcode",
  "qrcode": true,
  "integration": "WHATSAPP-BAILEYS"
}
```

### 2. Conectar WhatsApp

```http
GET /instance/connect/phosphorcode
apikey: SUA_API_KEY
```

Escaneie o QR Code com o WhatsApp.

### 3. Configurar webhook

```http
POST /webhook/set/phosphorcode
Content-Type: application/json
apikey: SUA_API_KEY

{
  "url": "https://SEU_DOMINIO/webhook/evolution",
  "webhook_by_events": false,
  "webhook_base64": false,
  "events": ["MESSAGES_UPSERT"]
}
```

> **Dica:** Para desenvolvimento local, use [ngrok](https://ngrok.com) ou [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para expor sua porta.

```bash
ngrok http 3000
# use a URL gerada como webhook
```

---

## Fluxo de uma conversa

```
Lead envia mensagem
  → Evolution API dispara webhook
  → server.js recebe POST
  → busca histórico no Redis
  → monta contexto + system prompt da Antonela
  → chama Claude API
  → detecta intenção na resposta
  → salva histórico atualizado
  → envia resposta via Evolution API
  → executa ação de intenção (se houver)
```

### Intenções detectadas

| Tag | Quando ocorre | Ação |
|---|---|---|
| `[AGENDAR]` | Lead quer marcar reunião | Envia link do calendário + notifica time |
| `[SUPORTE]` | Lead reporta problema técnico | Cria ticket + notifica time |
| `[ESCALAR]` | Lead quer falar com humano | Pausa o bot + notifica time urgente |
| `[LEAD_QUALIFICADO]` | Lead informou nome, empresa e segmento | Registra no CRM via webhook |

---

## Notificações do time

Configure ao menos um canal em `.env`:

### Webhook genérico (N8N, Make, Zapier)

```env
NOTIFY_WEBHOOK_URL=https://n8n.seudominio.com/webhook/antonela
```

Payload recebido:

```json
{
  "type": "LEAD_QUALIFICADO",
  "phone": "5561999999999@s.whatsapp.net",
  "name": "Dr. Paulo",
  "message": "...",
  "ts": "2026-06-18T14:30:00.000Z"
}
```

### Slack

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### WhatsApp do time

```env
TEAM_PHONE=5561999999999
```

---

## Deploy em produção

### PM2 (VPS simples)

```bash
npm install -g pm2
pm2 start src/server.js --name antonela
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json .
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
```

```bash
docker build -t antonela .
docker run -d --env-file .env -p 3000:3000 antonela
```

---

## Personalização

### Alterar tom ou conhecimento da Antonela

Edite o `SYSTEM_PROMPT` em `src/antonela.js`. As seções principais são:

- **Tom de voz** — como ela se comunica
- **Soluções** — o que ela pode apresentar
- **Regras** — o que ela nunca deve fazer

### Adicionar novas intenções

1. Adicione a tag no `SYSTEM_PROMPT` (ex: `[DEMONSTRACAO]`)
2. Inclua a tag no array `INTENTS` em `src/intent.js`
3. Crie o handler `handleDemonstracao()` no mesmo arquivo

### Suporte a mídia (áudio, imagem)

No `src/server.js`, a mensagem de áudio chega como `audioMessage` e imagem como `imageMessage`. Implemente transcrição via Whisper ou descrição via Claude Vision conforme necessário.

---

## Variáveis de ambiente completas

| Variável | Obrigatório | Descrição |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | API Key da Anthropic |
| `EVOLUTION_API_URL` | ✅ | URL da sua Evolution API |
| `EVOLUTION_API_KEY` | ✅ | API Key da Evolution |
| `EVOLUTION_INSTANCE` | ✅ | Nome da instância WhatsApp |
| `PORT` | — | Porta do servidor (padrão: 3000) |
| `REDIS_URL` | — | URL do Redis (sem ele: memória) |
| `CALENDAR_LINK` | — | Link de agendamento |
| `NOTIFY_WEBHOOK_URL` | — | Webhook de notificações |
| `SLACK_WEBHOOK_URL` | — | Webhook do Slack |
| `TEAM_PHONE` | — | WhatsApp do time |
| `LOG_LEVEL` | — | Nível de log (padrão: info) |

---

## Suporte

**Phosphorcode** · phosphorcode.com.br  
Engenharia de software para varejo e saúde.
