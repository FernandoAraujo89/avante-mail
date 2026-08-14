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

### Como um SMS sai daqui

Mesmo desenho dos outros dois canais: rota de disparo → fila no Redis → worker.

1. `POST /api/campaigns/[id]/send` reconhece `channel = "sms"`, recusa texto
   vazio ou com emoji, seleciona quem tem **celular + `sms_subscribed`** (lead
   nunca entra), cria um `campaign_sends` por contato e enfileira em
   `sms-sends`. Campanha agendada vira job com `delay`.
2. `worker/sms-worker.ts` consome a fila, revalida o consentimento **no momento
   do envio** (a campanha pode ter sido agendada semanas antes), translitera o
   texto e chama a Twilio.
3. O worker grava `campaign_sends.sms_segments` — a quantidade cobrada. É por
   isso que ela mora no envio e não é recalculada do texto da campanha: a conta
   do mês não pode mudar porque alguém duplicou a campanha e editou o texto.
4. Os dois webhooks fecham o ciclo: `/api/webhooks/twilio/status` atualiza a
   entrega e `/api/webhooks/twilio/inbound` registra resposta e opt-out.

Rodar o worker: `npm run worker:sms` (local) ou o serviço `sms-worker` do
`compose.yaml` (produção). Sem `TWILIO_SMS_ENABLED=true` e as envs completas
ele sobe em **modo ocioso** — loga o que falta e aguarda, sem crash loop e sem
tocar nos outros canais.

### Consentimento e opt-out

`sms_subscribed` é um aceite separado do WhatsApp: sair de um canal não tira a
pessoa do outro. Quem marca opt-in:

- cadastro manual e importação de CSV, **só quando o número é celular**;
- `scripts/backfill-sms-consent.ts`, para a base que já existia. Ele nunca toca
  em quem tem `sms_opt_out_at` preenchido e deixa fixo de fora, relatando
  quantos ficaram e por quê. Não tem prefixo `migrate-` de propósito: o deploy
  não o executa, senão cada subida reverteria as decisões tomadas depois.

  ```
  docker compose run --rm --no-deps app npx jiti scripts/backfill-sms-consent.ts
  ```

  É `jiti`, não `tsx` — veja o aviso abaixo. Rodado em 14/08/2026 na base de
  produção: 1.071 telefones, 1.035 celulares marcados, 36 fixos deixados de
  fora.

Quem tira: a pessoa respondendo `PARAR`/`SAIR`/`STOP` (webhook de entrada) ou a
própria Twilio, pelos erros 21610 (opt-out) e 21614 (número inválido ou fixo).
Nos dois casos o contato sai do canal na hora e nenhuma campanha futura tenta
de novo.

> **`tsx` quebra a libphonenumber-js — use `jiti` nos scripts de telefone.**
> Sob `npx tsx`, a metadata da `libphonenumber-js` chega embrulhada em
> `{ default: … }` e qualquer chamada morre com _"Cannot read properties of
> undefined (reading 'hasOwnProperty')"_. **Não é problema de versão do Node**:
> foi reproduzido no Node 26 do Mac e no `node:22-slim` do contêiner de
> produção. Quem carrega o módulo por outro caminho (Next.js, Vitest, `jiti`)
> não é afetado.
>
> O que decide não é importar `lib/phone.ts`, é **chamar** uma função que usa a
> biblioteca — `normalizePhone`, `formatPhone`, `firstValidPhone`,
> `parseBrazilianMobile`. Por isso `worker/whatsapp-worker.ts` roda sob `tsx`
> em produção sem problema: ele só usa `phoneToWaId`, que é um `replace` de
> string e não toca na libphonenumber.
>
> Regra prática: **script que mexe com telefone roda com `npx jiti`**, não com
> `npx tsx`. O `scripts/backfill-sms-consent.ts` é o caso vivo disso —
> `npm run backfill:sms` já usa o carregador certo.

### O que ainda falta no canal

- Aba de SMS no painel geral de **Relatórios** (o relatório por campanha já
  existe; o painel consolidado ainda só tem e-mail e WhatsApp).
- Passo `send_sms` nas **automações** (o canal só é usado por campanha).
- Reenvio por falha: hoje `/resend` vale só para o WhatsApp.

## Mexeu em dependência? Regenere o lock com o npm 10

O contêiner de produção é `node:22-slim`, que traz o **npm 10**. Uma máquina
com Node 24/26 traz o npm 11, e o lock que ele escreve pode ser recusado pelo
npm 10 no `npm ci` — com a mensagem "can only install packages when your
package.json and package-lock.json are in sync", listando pacotes que você
nunca instalou à mão (normalmente binários do `esbuild`).

O sintoma é cruel: `npm install`, `npm test` e `npm run build` continuam
passando na sua máquina, e **só o deploy quebra**, no `docker compose build`.
Foi o que segurou as fases 1 e 2 do canal SMS de 11 a 14/08/2026 sem ninguém
perceber.

Depois de qualquer `npm install`/`npm uninstall`, rode:

```
npm run lock:prod
```

Ele regenera só o `package-lock.json` usando o npm 10, sem tocar em
`node_modules`. Confira que o diff traz apenas entradas novas — se alguma
versão existente mudar, foi o `npm install` que atualizou dependência, não o
lock. E rode o deploy até o fim: `deploy.sh` falha ruidosamente, mas a última
linha que ele imprime antes de morrer é o erro real.

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
