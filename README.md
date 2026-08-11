# ▲ Avante Mail

Sistema de e-mail marketing da **Avante Soluções Digitais** — substituto do
ActiveCampaign para gestão e disparo de e-mails para parceiros (White Label,
Indicador e Revenda Fiscal).

## Stack

| Camada     | Tecnologia                                  |
| ---------- | ------------------------------------------- |
| Framework  | Next.js 15 (App Router, TypeScript estrito) |
| Banco      | PostgreSQL serverless (Neon) + Drizzle ORM  |
| Fila       | Upstash Redis + BullMQ                      |
| E-mails    | Resend + MJML (compilado no servidor)       |
| UI         | Tailwind CSS v4 + shadcn/ui (tema dark)     |

## Setup inicial

```
──────────────────────────────────────────
AVANTE MAIL — SETUP INICIAL
──────────────────────────────────────────

1. NEON POSTGRESQL (banco gratuito)
   → Acesse: https://neon.tech
   → Crie uma conta e um novo projeto chamado "avante-mail"
   → Copie a connection string (formato: postgresql://...)
   → Cole em DATABASE_URL no .env.local

2. UPSTASH REDIS (fila gratuita)
   → Acesse: https://upstash.com
   → Crie uma conta → Redis → Create Database → "avante-mail"
   → Selecione a região São Paulo (se disponível)
   → Copie UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
   → Cole no .env.local

3. RESEND (envio de e-mail gratuito)
   → Acesse: https://resend.com
   → Crie uma conta gratuita
   → API Keys → Create API Key → cole em RESEND_API_KEY
   → Para testar SEM domínio próprio: use RESEND_FROM_EMAIL=onboarding@resend.dev
     (só envia para o e-mail cadastrado na conta — perfeito para testes)
   → Quando tiver domínio: adicione o DNS e use seu e-mail real

4. INSTALAR DEPENDÊNCIAS
   npm install

5. CRIAR TABELAS NO BANCO
   npx drizzle-kit push

6. POPULAR COM DADOS DE TESTE
   npx tsx scripts/seed.ts

7. RODAR O PROJETO (2 terminais)
   Terminal 1 — Next.js:
   npm run dev

   Terminal 2 — Worker de e-mails:
   npx tsx watch worker/email-worker.ts

8. ACESSAR
   → http://localhost:3000

──────────────────────────────────────────
```

Antes de tudo: `cp .env.local.example .env.local` e preencha as variáveis
(gere o `JWT_SECRET` com `openssl rand -hex 32`).

## Scripts

| Comando            | O que faz                                  |
| ------------------ | ------------------------------------------ |
| `npm run dev`      | Next.js em modo dev (localhost:3000)       |
| `npm test`         | Testes de unidade (vitest)                 |
| `npm run worker`   | Worker de disparo (BullMQ, tsx watch)      |
| `npm run seed`     | Popula o banco com dados de teste          |
| `npm run db:push`  | Cria/atualiza as tabelas no Neon           |
| `npm run db:studio`| Abre o Drizzle Studio para inspecionar     |
| `npm run build`    | Build de produção                          |

## Arquitetura do disparo

```
POST /api/campaigns/[id]/send
  1. Busca contatos elegíveis (segmento + tags + subscribed=true)
  2. Cria um registro em campaign_sends por contato (status: pending)
  3. Enfileira os jobs na fila "email-sends" (Upstash Redis)
     · campanhas agendadas viram jobs com delay (BullMQ delayed jobs)
  4. Campanha vira "sending" (ou "scheduled")

worker/email-worker.ts (processo separado, concorrência 5)
  a. Carrega contato, campanha e template
  b. Substitui as variáveis Handlebars no MJML e compila para HTML
  c. Injeta o pixel de abertura e o link de clique rastreado
  d. Envia via Resend (limite de 2 e-mails/s, com 3 tentativas)
  e. Atualiza campaign_sends (sent/failed)
  f. Quando não resta envio pendente → campanha vira "sent"
```

### Tracking

- **Abertura**: pixel 1×1 em `/api/track/open?sid=...`
- **Clique**: o CTA passa por `/api/track/click?sid=...&url=...` e redireciona
- **Descadastro**: link com JWT em `/unsubscribe?token=...` (página pública)

## Canal SMS (Twilio)

Terceiro canal, ao lado de e-mail e WhatsApp: mesma campanha, mesma fila,
mesma tabela de envios, mesmo painel de métricas.

### Configuração

1. **Console da Twilio → Account → API keys & tokens**: crie uma API Key do
   tipo **Restricted** com permissão de _Read_, _List_ e _Create_ somente em
   **messages**. Guarde o Secret — ele aparece uma única vez.
2. **Messaging → Services**: copie o SID do Messaging Service do SMS (começa
   com `MG`). É por ele que tudo é enviado — nunca pelo número.
3. Preencha no `.env.local` (em produção, no `.env.local` **do servidor**, que
   o `deploy.sh` não sobrescreve):

   ```
   TWILIO_SMS_ENABLED=true
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_API_KEY_SID=SK...
   TWILIO_API_KEY_SECRET=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_SMS_MESSAGING_SERVICE_SID=MG...
   TWILIO_STATUS_CALLBACK_URL=https://campanhas.avantetools.com.br/api/webhooks/twilio/status
   ```

4. Suba a app. Com o canal ligado e alguma variável faltando, ela **não sobe** e
   diz exatamente qual falta (`instrumentation.ts`). Para desligar o canal,
   `TWILIO_SMS_ENABLED=false`.

### Duas credenciais, dois papéis

Trocar uma pela outra é o erro clássico do setup:

| Credencial              | Para quê                                          |
| ----------------------- | ------------------------------------------------- |
| API Key SID + Secret    | Autentica as **chamadas à API** (envio)           |
| Auth Token              | Valida a **assinatura dos webhooks** que chegam   |

O Auth Token não autentica chamada nenhuma aqui: a API Key Restricted tem o
mínimo de permissão necessária, e é ela que envia.

### GSM-7 e custo

O SMS cobra por **segmento**, não por mensagem. Em GSM-7 cabem 160 caracteres
por segmento; um único caractere fora do alfabeto (um emoji, um travessão
colado do Word) derruba a mensagem inteira para UCS-2 e o segmento cai para
70 — um texto de 150 caracteres passa de 1 para 3 segmentos, triplicando o
custo sem aviso. Por isso `lib/sms/gsm7.ts` translitera acentos (`ç`→`c`,
`ã`→`a`) e bloqueia emoji, e o editor mostra a prévia sanitizada, a contagem e
o custo antes do disparo.

Telefone segue o mesmo rigor: `lib/sms/phone.ts` aceita a bagunça que vem de
planilha (`(37) 99947-2264`, `037 9947-2264`, `+55…`) e recusa fixo, DDD
inexistente e número de outro país — SMS para fixo é dinheiro jogado fora.

## Decisões de engenharia

- **BullMQ + Upstash**: o BullMQ fala o protocolo Redis nativo (TCP), não a
  API REST. O endpoint TCP (`rediss://default:TOKEN@host:6379`) é derivado
  automaticamente de `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  em `lib/queue.ts` — você só preenche os dois valores REST.
- **Coluna `body` em campaigns**: o conteúdo que preenche `{{corpo}}` é da
  campanha (escrito no passo 1 do wizard), não do template.
- **Limite de 2 e-mails/s** no worker: teto do plano gratuito do Resend.
  A concorrência de 5 continua valendo; o limiter só espaça as chamadas.
- **Descadastro com clique**: a página `/unsubscribe` pede confirmação em vez
  de descadastrar no GET — evita descadastros acidentais por scanners de
  link dos provedores de e-mail.

## Variáveis dos templates MJML

`{{nome_parceiro}}` `{{titulo}}` `{{subtitulo}}` `{{corpo}}`
`{{cta_texto}}` `{{cta_url}}` `{{unsubscribe_url}}`
