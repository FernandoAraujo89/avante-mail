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
