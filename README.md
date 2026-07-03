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

## Prospecção ativa (cadência D0 / D+3 / D+7)

A Antonela também pode prospectar leads frios em vez de só responder quem chama primeiro. Fluxo:

1. Leads ficam numa planilha do Google Sheets (colunas: telefone, nome, empresa).
2. `POST /admin/prospect/import` (com header `x-admin-key`) lê a planilha e importa os leads pro Supabase como `pending`.
3. Um tick periódico (`PROSPECT_TICK_MS`) envia o próximo toque de quem está vencido: D0 → aguarda 3 dias → D+3 → aguarda 4 dias → D+7 (último toque).
4. Se o lead responder, a cadência para e a Antonela assume a conversa normalmente.
5. Se o lead responder "PARAR" (ou variações), ele é marcado como `opted_out` e recebe confirmação, sem nunca mais ser contatado.

Crie a tabela no Supabase (SQL Editor) antes de usar:

```sql
create table prospecting_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- formato "55DDDNUMERO@s.whatsapp.net"
  name text,
  company text,
  status text not null default 'pending',   -- pending | contacted_d0 | contacted_d3 | done | replied | opted_out
  touch_count int not null default 0,
  next_touch_at timestamptz not null default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Variáveis necessárias: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PROSPECT_SHEET_ID`, `PROSPECT_SHEET_RANGE` (reaproveita `GOOGLE_CREDENTIALS_PATH` já usado pelo Calendar). Sem `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` configurados, a prospecção fica desativada e a Antonela funciona só no modo reativo de sempre.

> **Atenção:** a Evolution API é WhatsApp não oficial (Baileys). Envio em volume para contatos frios pode levar ao banimento do número. Ajuste `PROSPECT_BATCH_SIZE`/`PROSPECT_TICK_MS` com cautela e considere migrar pra WhatsApp Business Cloud API oficial se o volume crescer.

---

## Free Prospecting Intelligence (descoberta de empresas novas, 100% grátis)

Diferente da cadência acima (que trabalha com leads já conhecidos, vindos de planilha), este módulo **descobre** empresas novas por cidade e segmento, usando só fontes gratuitas, e manda cada uma achada pro grupo do WhatsApp **"Phosphor Leads"**.

```http
POST /admin/prospect/discover
x-admin-key: SUA_ADMIN_KEY
Content-Type: application/json

{ "city": "Brasília", "uf": "DF", "segment": "industria", "cnae": "2511000", "maxResults": 20 }
```

`segment` aceita `industria`, `distribuidora`, `servicos_campo`, `clinicas`, `franquias` ou `agro`. `saude` e `varejo` continuam funcionando como compatibilidade, mas a estratégia comercial prioriza indústria e distribuidoras. `cnae` é opcional (só funciona com `BRASILIO_API_TOKEN` configurado, ver abaixo). A resposta é imediata (`202`), o processamento roda em background, cada lead aparece no grupo conforme é processado, e a rodada termina com um resumo (quantos leads por tier, quantos com decisor confirmado, maiores lacunas).

### Como funciona (descoberta em cascata + limitações reais)

Nenhuma das 5 APIs gratuitas de CNPJ (CNPJá, BrasilAPI, CNPJ.ws, Minha Receita, OpenCNPJ) permite **buscar** empresas por cidade ou CNAE — elas só consultam por CNPJ exato. A descoberta em si combina duas fontes gratuitas, na ordem:

1. **OpenStreetMap** (Nominatim + Overpass) — bom pra negócio físico, busca por tags do segmento dentro da cidade.
2. **brasil.io** (opcional, precisa de `BRASILIO_API_TOKEN`) — busca por CNAE + município direto nos Dados Abertos da Receita Federal. É o único jeito gratuito de buscar por CNAE; sem token, a descoberta cai só pro Overpass.
3. **Apify Google Maps Scraper** (opcional, precisa de `APIFY_API_TOKEN`) — busca empresas no Google Maps por termo + cidade, trazendo telefone, site e, se habilitado, contatos do site.

Os candidatos das duas fontes são deduplicados (por CNPJ, ou por nome normalizado quando não há CNPJ) antes de gastar esforço enriquecendo. Pra cada candidato: o CNPJ é extraído do próprio site quando não veio pronto (regex no HTML da home e, se não achar, também em `/politica-de-privacidade` e `/termos-de-uso` — testado com um caso real onde o CNPJ só aparecia nessas páginas), do site também são raspados **e-mail, telefone e WhatsApp** (`mailto:`, `tel:`, `wa.me`) como fallback empresarial, o CNPJ é enriquecido via os 5 providers (razão social, QSA, situação, **porte e capital social**), e opcionalmente (com `BRAVE_API_KEY`) uma busca web tenta achar o **site oficial** (quando o candidato veio sem site — o que destrava o CNPJ e, por consequência, porte e decisor), além de Instagram, LinkedIn e menções ao decisor, cruzando o nome achado com o QSA. Depois disso, a busca prioriza contato público do decisor real em camadas: LinkedIn pessoal, Instagram pessoal, páginas do site oficial que citam o nome (`/equipe`, `/time`, `/diretoria`, `/quem-somos`, `/contato`), snippets públicos com e-mail/telefone/WhatsApp associados ao nome e variações de cargo como sócio, fundador, proprietário, CEO, diretor e administrador. Contato da empresa só aparece como fallback quando não houver contato pessoal do decisor. Quando não há site nem CNPJ visível, o lead ainda é salvo e notificado, mas com `enrichment_status = partial` e a lacuna registrada.

**Filtro de tamanho (foco em PME/MEI):** quando o porte é conhecido (via CNPJ enriquecido ou brasil.io), empresas grandes são descartadas antes de salvar/notificar — o padrão aceita MEI/ME/EPP e descarta "Demais" (`PROSPECT_MAX_PORTE`, default `EPP`), com um teto de capital social pra pegar as grandes que escapam do porte (`PROSPECT_MAX_CAPITAL_SOCIAL`, default R$ 10 mi). O resumo da rodada informa quantas foram descartadas. **Importante:** o Overpass sozinho não traz porte nem CNPJ, então o filtro só é efetivo com `BRASILIO_API_TOKEN` configurado (ou quando o CNPJ é achado no site do candidato). Sem dado de porte, o lead é mantido e marcado com a lacuna "porte não confirmado", pra revisão humana.

### Confiança e Tier

Cada lead recebe:
- `confianca`: `alta` (decisor confirmado em ≥2 fontes), `media` (1 fonte só) ou `baixa` (sem decisor identificado)
- `tier`: `A` (score ≥60, contato pessoal do decisor e confiança não-baixa — pode abordar), `B` (score ≥35, tem contato acionável, inclusive fallback empresarial), `C` (dados fracos, precisa de revisão humana)

Além do card no WhatsApp (formato humano), cada lead processado é logado em JSON estruturado (`logger.info`, evento "📊 Lead processado") no schema `{ nicho, empresa, cnpj, site, telefone, whatsapp, instagram, linkedin, decisor_nome, decisor_cargo, decisor_email, decisor_telefone, decisor_whatsapp, decisor_linkedin, decisor_instagram, decisor_fontes_contato, decisor_camadas_contato, porte, capital_social, fontes, confianca, tier, lacunas, dor_principal, oferta }` — útil pra consumir os resultados de outro sistema depois, sem precisar de endpoint novo.

> Os 5 providers (`src/cnpjProviders.js`, incluindo a BrasilAPI — que exige User-Agent de browser, senão a Cloudflare devolve 403) e o Overpass/Nominatim (`src/discovery.js`) foram testados ao vivo com CNPJs e cidades reais durante o desenvolvimento — os mapeamentos de campo batem com as respostas reais observadas. A extração de CNPJ do site (`src/companyIntel.js`) valida o dígito verificador antes de aceitar qualquer match, pra não confundir CNPJ real com placeholder de máscara de formulário (ex: `00000000000000`, comum em campos de formulário vazios).
>
> **`src/brasilioProvider.js` e `src/braveSearch.js` não foram testados ao vivo** — as duas APIs exigem token/chave que este ambiente de desenvolvimento não tinha. Os nomes de campo do brasil.io seguem o padrão dos Dados Abertos da Receita (mesma origem da Minha Receita), mas confira na primeira execução real e ajuste `firstOf(...)` se precisar.

### Comando `/empresa` no grupo "Phosphor Leads"

Além da descoberta automática, dá pra consultar uma empresa específica digitando no próprio grupo:

```
/empresa Clinica Sabin
/empresa sabin.com.br
/empresa 19131243000197
```

O sistema detecta sozinho se você mandou CNPJ, site ou nome. Pra nome, a busca é restrita à cidade de `PROSPECT_TARGET_CITY`/`PROSPECT_TARGET_UF` (uma busca sem cidade, em todo o Brasil, foi testada e dá timeout no servidor público do Overpass). O bot responde no mesmo grupo com um card contendo CNPJ, razão social, contato, site, Instagram/LinkedIn (se achados), decisor provável, score, tier e confiança, e um resumo da empresa.

### Comando `prospecte N empresas de <nicho>` no grupo "Phosphor Leads"

Para iniciar uma rodada direto pelo grupo:

```
prospecte 10 empresas de indústrias
prospecte 15 empresas de distribuidoras
prospecte 8 empresas de serviços em campo
prospecte 8 empresas de clínicas
prospecte 8 empresas de franquias
prospecte 8 empresas de agro
```

Se mandar só `prospecte 10 empresas`, a Antonela responde pedindo o nicho. Os nichos mapeados são `indústrias`, `distribuidoras`, `serviços em campo`, `clínicas`, `franquias` e `agro`. A cidade/UF vêm de `PROSPECT_TARGET_CITY` e `PROSPECT_TARGET_UF`. O limite de segurança do comando é 50 empresas por rodada.

### Schema Supabase

Se você já tem a tabela `company_leads` de uma versão anterior, rode só o `alter table` abaixo (não perde dados existentes):

```sql
create table company_leads (
  id uuid primary key default gen_random_uuid(),
  cnpj text unique,
  razao_social text,
  nome_fantasia text,
  telefone text,
  whatsapp text,
  email text,
  website text,
  instagram text,
  linkedin text,
  cnae_principal text,
  cnae_descricao text,
  cidade text,
  uf text,
  endereco text,
  decision_maker_name text,
  decision_maker_role text,
  decision_maker_confidence numeric,
  decision_maker_email text,
  decision_maker_phone text,
  decision_maker_whatsapp text,
  decision_maker_linkedin text,
  decision_maker_instagram text,
  decision_maker_contact_sources jsonb,
  decision_maker_contact_layers jsonb,
  fit_score int,
  suggested_message text,
  source text,                               -- overpass | brasilio | brave-site | cnpja | brasilapi | cnpjws | minhareceita | opencnpj | manual-site | manual-cnpj | inbound-whatsapp | inbound-site
  segment text,                              -- industria | distribuidora | servicos_campo | clinicas | franquias | agro (null em /empresa manual)
  fontes jsonb,                              -- ex: ["overpass","cnpja","qsa","brave-linkedin"]
  lacunas jsonb,                             -- ex: ["telefone não encontrado"]
  confianca text,                            -- alta | media | baixa
  tier text,                                 -- A | B | C
  enrichment_status text default 'pending',  -- pending | enriched | failed | partial
  notified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Se a tabela já existir de antes:
alter table company_leads
  add column if not exists segment text,
  add column if not exists whatsapp text,
  add column if not exists linkedin text,
  add column if not exists confianca text,
  add column if not exists tier text,
  add column if not exists fontes jsonb,
  add column if not exists lacunas jsonb,
  add column if not exists decision_maker_email text,
  add column if not exists decision_maker_phone text,
  add column if not exists decision_maker_whatsapp text,
  add column if not exists decision_maker_linkedin text,
  add column if not exists decision_maker_instagram text,
  add column if not exists decision_maker_contact_sources jsonb,
  add column if not exists decision_maker_contact_layers jsonb;
```

Variáveis necessárias: `LEADS_GROUP_JID` (grupo "Phosphor Leads" — também é o único grupo onde os comandos de prospecção são aceitos), `PROSPECT_TARGET_CITY`/`PROSPECT_TARGET_UF` (bônus de score, cidade usada na busca por nome e cidade da rodada pelo comando), `PROSPECT_CONTACT_EMAIL` (exigido pela política de uso do Nominatim). Reaproveita `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` já configurados pra cadência. Opcionais: `BRASILIO_API_TOKEN` (descoberta por CNAE), os CNAEs por nicho (`PROSPECT_INDUSTRIA_CNAE`, `PROSPECT_DISTRIBUIDORA_CNAE`, `PROSPECT_SERVICOS_CAMPO_CNAE`, `PROSPECT_CLINICAS_CNAE`, `PROSPECT_FRANQUIAS_CNAE`, `PROSPECT_AGRO_CNAE`) e `BRAVE_API_KEY` (Instagram/LinkedIn/decisor via busca web) — sem elas o sistema funciona igual, só sem essas duas fontes extras.

Para usar Apify na descoberta, configure `APIFY_API_TOKEN`. O actor padrão é `compass/crawler-google-places`, customizável por `APIFY_GOOGLE_MAPS_ACTOR`; termos customizados vão em `APIFY_SEARCH_TERMS=clinica,dentista`. `APIFY_SCRAPE_CONTACTS=true` habilita o add-on pago de contatos do site quando sua conta/actor permitir.

Nenhuma mensagem é enviada automaticamente ao lead — o texto sugerido só vai pro grupo interno, para aprovação humana antes de qualquer contato.

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
Sistemas sob medida para empresas que cresceram mais rápido que seus processos.
