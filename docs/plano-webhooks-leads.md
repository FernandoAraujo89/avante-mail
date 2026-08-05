# Plano — Gestão de leads, entrada por webhook e Lead Score

Objetivo: capturar leads de fora (Make, formulários, anúncios) com a **origem
completa** (UTMs), mantê-los numa **lista própria**, e pontuá-los conforme os
pontos de contato com os canais da Avante.

---

## ▶ ESTADO ATUAL (05/08/2026)

**As seis fases estão prontas.**

| Fase | Situação | Commit |
|---|---|---|
| A — Entrada por webhook + UTMs | ✅ produção | `1984395` |
| — Correção do consentimento | ✅ produção | `5060116` |
| B — Campos de lead + travas | ✅ produção | `71ba61e` |
| D — Área de Leads + cadastro de origens | ✅ produção | `06aa4f5` |
| C — Lead Score | ✅ produção | `7b3ad17` |
| E — Rastreio do site | ✅ produção | `b54eb69` |
| F — Webhook de saída | ✅ feita | |

**O plano está completo.** As seis fases existem; o que falta é operação, não
construção: ligar uma origem de webhook (fase A), colar a tag no site e decidir
o consentimento (fase E), e autorizar destinos de saída (fase F).

**A ordem mudou:** a fase D veio antes da C porque o usuário pediu a separação
da gestão de leads e o cadastro de origens pela tela.

### O Lead Score (fase C)

Migração: `scripts/migrate-lead-score.ts`. O motor vive em `lib/leads/score.ts`
e roda no ciclo do worker de automações — em `try` próprio, para uma falha na
pontuação não derrubar o que move campanha.

| Peça | Onde |
|---|---|
| Cálculo, decaimento e faixas | `lib/leads/score.ts` |
| Recálculo a cada 10s (quem teve evento novo) | `worker/automation-worker.ts` |
| Passagem diária (aplica o decaimento em quem parou) | idem, guardada por `app_settings` |
| Modelo editável | `/leads/pontuacao` |
| Conta aberta | `/leads/[id]` (card Pontuação) |

**Derivado, nunca incrementado:** cada cálculo relê `contact_events` do zero, e
é isso que faz mudar um peso valer para o histórico inteiro. Salvar na tela de
Pontuação recalcula todo mundo na hora — sem isso, a regra nova conviveria com
números velhos até a madrugada e ninguém confiaria no valor.

**Decaimento por meia-vida de 30 dias.** Verificado com três leads de eventos
idênticos e idades diferentes: 32 → 16 → 4 pontos (hoje, 30 dias, 90 dias).

**Só a virada de FAIXA vira evento** (`lead_score_changed`). O número muda a
cada passagem por causa do decaimento; registrar toda variação encheria a linha
do tempo sem informar nada. Os tipos sem regra ativa ficam fora da detecção de
"quem precisa recalcular" — inclusive o próprio `lead_score_changed`, que senão
pediria um recálculo a cada recálculo.

**É gatilho de automação** desde `12e2d99`, com escolha de faixa no editor
("virou quente", "esfriou", ou qualquer mudança).

### Qualificação e etapa: o que o agente manda (05/08/2026)

Migração: `scripts/migrate-etapas-e-qualificacao.ts`.

Um **agente** conversa com o lead da campanha, qualifica, e manda para cá por
webhook. Depois ele acompanha o lead no **Pipedrive** e avisa de novo quando o
lead anda no funil. Não existe ponte de "entregar ao comercial": o lead já
nasce lá.

Duas informações, com donos diferentes:

| | Quem define | Onde mora | Por quê |
|---|---|---|---|
| **Qualificação** | playbook do SDR (nosso) | código (`components/leads/qualificacoes.ts`) | vocabulário nosso, estável; muda quando o playbook muda |
| **Etapa** | funil do Pipedrive (deles) | tabela `lead_stages`, editável em `/leads/etapas` | muda quando o comercial quiser; como constante, cada etapa nova virava um deploy nosso — e até lá o webhook seria recusado |

**Os dois entram pela MESMA porta** (`/api/webhooks/entrada/{slug}`), com
`qualification` e `stage` no mapeamento da origem. Reusar a porta traz junto
autenticação, janela anti-repetição, log do corpo cru e reprocessamento — que
seriam reescritos numa rota nova.

**Eles SOBRESCREVEM, ao contrário de nome e empresa** (que só completam
lacunas). São o motivo do webhook existir: o agente sabe mais, e mais recente,
sobre os dois do que qualquer coisa daqui.

**Aceitam texto de conversa, não só slug.** "Sim: Experiente" vira
`experiente`; "Passou por apresentação de produto" vira
`apresentacao-de-produto`. O agente manda o que ele fala; recusar por causa de
um acento perderia a informação inteira.

**TRAVA: contato que não é lead não vira lead por webhook.** Um parceiro que
aparecesse num payload do agente teria `stage` preenchido e sairia calado de
toda campanha de parceiro. A entrega é aceita, o resto é aplicado, e a recusa
fica registrada em `webhook_deliveries.resultado.recusas` — mesmo princípio da
trava 1: o erro precisa aparecer, não sumir.

**Etapa marcada como "encerra a nutrição"** (ex.: Comprou) chama
`encerrarPercursosDoContato`. Mora na etapa, e não numa automação, porque é a
única ação que nenhum passo sabe fazer — não existe "encerre os outros fluxos".

**ORDEM: encerrar ANTES de emitir `lead_stage_changed`.** A automação que reage
a "comprou" (marcar a tag de ganho, avisar alguém) precisa poder rodar; se o
evento saísse primeiro, o percurso novo nasceria e morreria no mesmo instante.

Tudo o mais que a etapa deva provocar é **automação**, com gatilho `Lead andou
no funil` (com escolha de etapa) ou `Lead foi qualificado` (com escolha de
qualificação). Um mecanismo só para cada coisa.

**A etapa NÃO se muda pela tela.** Ela espelha o Pipedrive; um controle manual
seria uma segunda fonte da verdade sobre o mesmo fato, e as duas divergiriam no
primeiro dia em que alguém mexesse só de um lado.

**A qualificação pontua.** Quatro regras semeadas em `lead_score_rules`, com
`condition` por qualificação — Experiente 30, Alto Potencial 25, Intermediário
15, Iniciante 8. Editáveis em `/leads/pontuacao` como qualquer outra regra.

**Só as etapas que o usuário nomeou foram semeadas** (`qualificado`,
`apresentacao-de-produto`, `comprou`). O resto do funil se cadastra na tela:
inventar o funil dos outros é exatamente como a tela passa a mentir — já
aconteceu com as páginas do site no rastreio, e o custo foi retrabalho.

Três vocabulários convivem na ficha e não são a mesma coisa: **faixa** é
temperatura (o sistema calcula), **qualificação** é quem o lead é (o agente
decide), **etapa** é onde ele está no funil do Pipedrive.

### A regra que passou a valer (04/08/2026)

**Campanha é de parceiro, cliente e colaborador. Lead NUNCA entra — sem
exceção e sem opção.** A trava 2 deixou de ter a caixa "Incluir leads": a
opção explícita do plano original foi removida a pedido do usuário. Quem fala
com lead é a **automação de nutrição**, não a campanha.

Consequências no código:
- o `/send` sempre aplica `naoEhLead()` — não há mais condição;
- a lista de leads não aparece no seletor de listas do wizard;
- `campaigns.include_leads` continua no banco (migração da fase B) mas saiu do
  schema do Drizzle e não é lida por ninguém. Não foi derrubada porque apagar
  coluna em produção não se desfaz, e uma coluna inerte não custa nada.

### A área de Leads (fase D)

Menu próprio na sidebar, agrupado por ÁREA — "Relacionamento" (campanhas,
automações, contatos, listas) e "Leads" (gestão + origens). Ver os dois grupos
separados é o que impede tratar lead como parceiro.

| Tela | O que faz |
|---|---|
| `/leads` | funil por ETAPA, busca, filtros por qualificação, faixa e canal |
| `/leads/[id]` | ficha: qualificação (com o texto do playbook), etapa, origem completa, linha do tempo, automações; converte em parceiro |
| `/leads/etapas` | cadastro das etapas do funil do Pipedrive |
| `/leads/origens` | cadastro das origens de webhook, sem script |

**Cadastro de origem pela tela:** nome (o endereço sai do nome, sem acento),
mapeamento campo a campo (incluindo qualificação e etapa), tags, chave de
consentimento,
liga/desliga, token com giro, e as últimas 50 entregas cruas.

Duas coisas que a tela ganhou e o script não tinha:
- **ensaio do mapeamento** (`POST /api/leads/origens/testar`): cola-se o corpo
  real e o sistema mostra o que sairia dele, sem gravar nada. Configurar
  mapeamento às cegas é o jeito garantido de descobrir o erro quando o lead
  some;
- **histórico de entregas na própria janela**, que é onde se lê *por que* um
  payload foi recusado.

`listId` saiu do cadastro: desde a trava 1 o destino é sempre a lista de leads,
então oferecer a escolha seria oferecer uma opção que o sistema ignora.

**O que já roda:** `POST /api/webhooks/entrada/{slug}` autenticado por token,
com mapeamento por origem, idempotência (identidade + janela de 5min) e
registro de tudo em `webhook_deliveries`. O lead entra na lista "Leads", com
UTMs, `stage = novo`, e emite os eventos que alimentam automação e score.
Colunas de origem/estágio já existem em `contacts`.

### As três travas (fase B)

Migração: `scripts/migrate-leads-travas.ts` (roda sozinha no deploy).

| # | Trava | Onde |
|---|---|---|
| 1 | Lead só entra em lista marcada como de leads | `lib/webhooks/entrada.ts` |
| 2 | Campanha exclui lead, salvo opção explícita | `app/api/campaigns/[id]/send` |
| 3 | Filtro e selo de estágio em Contatos | `app/(app)/contacts/page.tsx` |

**Quem é lead: `contacts.stage` preenchido** — e não "está na lista Leads".
A diferença importa: um PARCEIRO que preenche um formulário do site entra na
lista de leads pelo webhook, mas continua com `stage` nulo (a entrada não
sobrescreve contato existente). Pela lista, ele sumiria calado das campanhas de
parceiro; pelo estágio, ele segue parceiro — que é o que ele é. `lib/leads.ts`
é o ponto único dessa definição.

`lists.kind = 'leads'` marca a lista; o nome pode ser trocado na tela sem
desfazer a trava. A trava 1 **recusa** a lista pedida pela origem quando não é
de leads (registra `listaRecusada` na entrega) e usa a de leads no lugar —
obedecer poria o lead na lista de parceiros, e no dia seguinte ele seria
público de campanha.

`campaigns.include_leads` (padrão false, inclusive nas campanhas antigas e no
Avante News) é a opção explícita da trava 2. Ela vale no **envio**, não no
seletor: escolher os leads a dedo no passo Destinatários **não** fura a trava.
A cópia de uma campanha não herda a opção — incluir lead é decisão de um envio.

**Como ligar uma origem:**
`npx tsx scripts/criar-origem-webhook.ts make-leads "Make — Leads do site"`
— mostra URL e token UMA vez (o banco guarda só o hash). Um `GET` na mesma URL
com o token confere a configuração sem criar lead. O `mapping` da origem muda
o formato aceito **sem deploy**.

### A correção que a fase A obrigou (importante)

`subscribed = false` significava duas coisas — "pediu para sair" e "nunca deu
aceite" — e o motor das automações parava o percurso nas duas. Resultado:
nenhum lead novo podia ser nutrido, que é o motivo de receber lead.

Agora `contacts.email_opt_out_at` marca a supressão de verdade (descadastro,
devolução definitiva, reclamação de spam):

| Estado | Automação | E-mail |
|---|---|---|
| liberado | roda | envia |
| sem aceite | **roda** | **não envia** |
| suprimido (`email_opt_out_at`) | **para** | não envia |

A guarda de consentimento passou a viver no **passo de envio de e-mail**
(`lib/automations/envios.ts`) — antes quem barrava era a regra de parada do
motor, então afrouxá-la sem isso mandaria e-mail para quem nunca consentiu.

**Decisão revista:** o padrão do sistema é **liberar**; a origem bloqueia com
`"consentimento": false` nos defaults.

**Fora de propósito:** corpo com JSON quebrado responde 400 mas não é
registrado em `webhook_deliveries` — não dá para guardar como jsonb o que não
é JSON. Se quiser rastreabilidade total, guardar o texto cru num campo à parte.

---


---

## 1. As definições do usuário (03/08/2026)

1. Leads ficam numa **lista separada**; só essa lista aparece na área de gestão.
2. Contatos de lead ganham **campos novos**, principalmente de **origem** —
   UTMs, para saber se veio do Instagram, Facebook, Google Search, Google Ads.
3. A área de gestão é onde vive o **Lead Score**, que analisa todos os pontos
   de contato possíveis: abertura de e-mail, acesso ao site, eventos no site,
   Instagram etc.

Isso resolve a dúvida do plano anterior: **lead é contato**, e a separação é
feita pela **lista** — que já existe, já filtra campanha e já é entendida pela
equipe. Sem tabela paralela, sem identidade duplicada.

---

## 2. O Make: o que a integração realmente exige

O link enviado (`developers.make.com/api-documentation`) é a **API de gestão do
Make** — cria e roda cenários. **Não precisamos dela.** O caminho é o inverso:
o cenário usa o módulo **HTTP** para fazer POST na nossa URL.

Sem token do Make para guardar, sem integração para manter — e o mesmo endpoint
serve para Typeform, RD Station, formulário do site, n8n ou Zapier.

| | Comportamento | Consequência |
|---|---|---|
| Cabeçalhos | o módulo HTTP envia os personalizados | token no cabeçalho basta |
| Repetição | **não repete sozinho**; é configurada no cenário | cenário rodado de novo manda o lead duas vezes — **idempotência é problema nosso** |
| Tempo limite | 1–300s (padrão 40s) | dá para responder de forma síncrona, com resultado real |

---

## 3. Modelo de dados

### Campos novos em `contacts`

```
-- Estágio: NULL = não é lead (parceiro/contato comum)
stage            'novo' | 'contatado' | 'qualificado' | 'convertido' | 'perdido'
ownerUserId      responsável pelo acompanhamento

-- Origem do PRIMEIRO contato (aquisição) — não muda depois
sourceChannel    'instagram' | 'facebook' | 'google_ads' | 'google_search' | …
utmSource, utmMedium, utmCampaign, utmContent, utmTerm
landingPage      URL onde converteu
referrer
sourceDetail     nome do cenário/formulário que enviou
acquiredAt

-- Pontuação
leadScore        integer, calculado (ver seção 6)
leadScoreBand    'frio' | 'morno' | 'quente'
leadScoreAt
```

### Primeiro toque, e não último

A origem é gravada **uma vez**, na entrada, e não é sobrescrita. Um lead que
chega pelo Instagram e volta seis meses depois por uma busca no Google continua
sendo "veio do Instagram" — é isso que responde "qual canal traz lead".

As visitas seguintes ficam registradas como **pontos de contato** (seção 6), que
é onde o histórico multicanal aparece sem apagar a aquisição.

> Se o time quiser também o último toque, é um segundo conjunto de campos
> (`lastUtm*`). Não recomendo começar por aí: dobra o custo de manutenção antes
> de existir pergunta que precise disso.

### Tabelas novas

```
webhook_sources        origens que podem nos chamar
  id, name, slug, tokenHash, secret (HMAC, opcional),
  mapping jsonb, defaults jsonb, active, createdAt, lastSeenAt

webhook_deliveries     tudo que chegou (auditoria e reprocessamento)
  id, sourceId, payload jsonb, status, resultado jsonb, erro,
  createdAt                       -- expurgo automático em 90 dias

lead_score_rules       o modelo de pontuação, editável na tela
  id, eventType, condition jsonb, points, active, description
```

---

## 4. Entrada por webhook

```
POST /api/webhooks/entrada/{slug}
Authorization: Bearer <token da origem>
```

Um `slug` por origem: dá para revogar uma sem derrubar as outras e para saber
de onde cada lead veio sem adivinhar.

### Mapeamento por origem (sem deploy para cada nova)

Mesmo conceito da importação de CSV, que a equipe já usa:

```jsonc
// mapping — de onde tirar cada campo (aceita caminho com ponto)
{
  "name":  "data.nome",
  "email": "data.email",
  "phone": "data.telefone",
  "utmSource":   "data.utm_source",
  "utmMedium":   "data.utm_medium",
  "utmCampaign": "data.utm_campaign",
  "landingPage": "data.pagina"
}

// defaults — o que aplicar quando não vier no payload
{ "tags": ["lead"], "stage": "novo", "listId": "<uuid da lista Leads>",
  "consentimento": false }
```

### O que acontece a cada chamada

```
1. valida o token da origem              → 401
2. valida o tamanho do corpo             → 413
3. grava a entrega crua                  → webhook_deliveries
4. aplica o mapeamento
5. valida e normaliza (e-mail, telefone E.164)  → 422 com o motivo
6. procura contato por e-mail/telefone   → cria ou atualiza
7. aplica lista, tags, estágio e ORIGEM (só se for contato novo)
8. emite os eventos                      → contact_created / tag_added
9. responde 200 dizendo o que fez
```

O passo 8 é o que faz o lead **cair direto numa automação de nutrição** — o
motor já está em produção, nada novo a construir.

Resposta útil para quem depura no Make:

```jsonc
{ "ok": true,  "acao": "criado",     "contactId": "…", "leadScore": 10 }
{ "ok": true,  "acao": "atualizado", "contactId": "…" }
{ "ok": true,  "acao": "ignorado",   "motivo": "entrega repetida" }
{ "ok": false, "erro": "e-mail inválido", "campo": "data.email" }
```

### Idempotência

O Make não repete sozinho, **mas o cenário pode ser rodado de novo** — e isso
acontece muito. Três defesas:

1. **Identidade**: e-mail (ou telefone) já existente vira atualização, nunca
   contato novo. Resolve a maioria dos casos sozinho.
2. **Chave externa**: se a origem mandar `externalId`, a repetição é ignorada
   explicitamente.
3. **Janela curta**: corpo idêntico da mesma origem em poucos minutos responde
   `ignorado` — contém cenário em laço.

---

## 5. As três travas contra disparo acidental ✅ FEITAS

Leads e parceiros na mesma tabela criam um perigo concreto: montar uma campanha,
deixar "todas as listas" e **disparar para os leads sem querer**. Obrigatórias:

1. Lead entra **só** na lista "Leads", nunca nas listas de parceiros.
2. ~~O seletor de destinatários exclui a lista de leads por padrão, com opção
   explícita para incluí-la.~~ **Revisto em 04/08/2026: não há opção.** Campanha
   nunca alcança lead (ver ESTADO ATUAL).
3. A tela de Contatos ganha filtro visível de estágio.

Ver o resumo da implementação no ESTADO ATUAL, no topo. Duas decisões que só
apareceram ao construir:

- a trava 2 vale por **contato** (`stage`), não por lista — então ela também
  pega o lead escolhido a dedo no passo Destinatários, que era o furo óbvio;
- o `stage` é a definição de "quem é lead" justamente porque um PARCEIRO que
  preenche um formulário entra na lista de leads mas mantém `stage` nulo: pela
  lista, ele sumiria calado das campanhas de parceiro.

---

## 6. Lead Score

### 6.1 O que dá para medir de verdade

Esta é a parte que precisa de honestidade antes de virar expectativa:

| Ponto de contato | Dá? | Como |
|---|---|---|
| Abertura de e-mail | ✅ **já capturado** | `contact_events.email_opened` |
| Clique em e-mail | ✅ **já capturado** | `email_clicked` |
| Resposta no WhatsApp | ✅ **já capturado** | `whatsapp_replied` |
| Entrada como lead | ✅ **já capturado** | `contact_created` |
| Descadastro | ✅ **já capturado** | serve como pontuação NEGATIVA |
| Origem do anúncio | ✅ na entrada | UTMs (seção 3) |
| Visita ao site | ⚠️ **exige trabalho** | script no site + identificação (6.4) |
| Evento no site (preço, demo, formulário) | ⚠️ mesmo mecanismo | evento nomeado pelo script |
| **Visita ao Instagram** | ❌ **impossível por pessoa** | ver abaixo |

**Sobre o Instagram:** nenhuma plataforma entrega "o lead Fulano visitou nosso
perfil" — o Instagram não expõe isso, para ninguém. O que existe de real é:

- **clique em link nosso** (link da bio passando pelo nosso redirecionador) → vira ponto de contato identificado;
- **origem por UTM** (`utm_source=instagram`) → aquisição, já contemplada;
- **DM ou comentário**, se um cenário do Make empurrar esses eventos para o nosso webhook.

Vale dizer isso ao time antes de prometerem "rastreamento de Instagram" a
alguém. O mesmo vale para Facebook.

### 6.2 O modelo de pontuação

Regras editáveis na tela, não no código:

| Evento | Pontos sugeridos |
|---|---|
| Entrou como lead | +10 |
| Abriu e-mail | +2 |
| Clicou em e-mail | +5 |
| Respondeu no WhatsApp | +15 |
| Visitou o site | +3 |
| Viu a página de preços | +10 |
| Pediu demonstração | +25 |
| Descadastrou | −30 |

### 6.3 Decaimento — sem isso o modelo apodrece

Sem decaimento, todo lead antigo vira "quente" e a pontuação perde sentido: quem
abriu dez e-mails há um ano fica na frente de quem pediu demonstração ontem.

Cada evento vale menos com o tempo, por **meia-vida** (sugestão: 30 dias):

```
pontos_hoje = pontos_da_regra × 0,5 ^ (idade_em_dias / 30)
```

Um clique de hoje vale 5; o mesmo clique de 30 dias atrás vale 2,5; de 60 dias,
1,25. A pontuação passa a refletir **interesse atual**, que é a pergunta real.

### 6.4 Como recalcular

A pontuação é **derivada**, nunca incrementada às cegas — assim mudar uma regra
vale para o histórico inteiro, e não só dali para a frente.

- **Por contato**, quando chegam eventos novos (o motor de automações já varre
  `contact_events` a cada 10s — é o lugar natural).
- **Passagem noturna** em toda a lista de leads, para aplicar o decaimento
  mesmo em quem não teve evento novo.

Com ~1.458 contatos e dezenas de eventos cada, o custo é irrelevante.

### 6.5 Faixas e o que elas disparam

`frio < 20 · morno 20–49 · quente ≥ 50` (configurável).

Mudança de faixa vira **evento** (`lead_score_changed`), que é gatilho de
automação. É aqui que o modelo deixa de ser um número bonito e vira operação:
*"quando o lead virar quente, avise o vendedor por WhatsApp e mude o estágio
para qualificado"* — tudo com o motor que já existe.

---

## 7. Rastreio do site (a parte difícil) ✅ FEITA

O problema não é registrar a visita; é **saber de quem ela é**. O site
(`avantejuntos.com.br`) e o sistema (`campanhas.avantetools.com.br`) são
domínios diferentes, e cookie de terceiro não existe mais.

### 7.0 O que foi construído, e as decisões que o plano não previa

**Configuração obrigatória (sem ela o rastreio é inerte, de propósito):**
`SITE_TRACK_ORIGINS` no `.env.local` do VPS, com as origens exatas do site.
Lista vazia = nada é rastreado e nenhum token é gerado. Opcional:
`TRACK_SECRET` (ver abaixo).

| Peça | Onde |
|---|---|
| Token assinado | `lib/track/token.ts` |
| Regras puras (allowlist, normalização, saneamento) | `lib/track/site.ts` |
| Script entregue ao site | `lib/track/script.ts` → `/api/track/site.js` |
| Endpoint de entrada | `app/api/track/site/route.ts` |
| Tela de diagnóstico e configuração | `/leads/rastreio` |
| Conferência sem banco | `npx tsx scripts/testar-track-site.ts` |

**1. Chave DERIVADA, não o `JWT_SECRET`.** Sessão (`lib/session.ts`) e
descadastro (`lib/jwt.ts`) assinam com o mesmo `JWT_SECRET` e se distinguem só
pela claim `purpose`. Um token de rastreio assinado com aquela chave — morando
no `localStorage` de um site que não controlamos — estaria a um descuido de
virar token de sessão. Aqui a chave sai de um HKDF sobre o `JWT_SECRET`, com
rótulo próprio: a confusão deixa de ser possível **por construção**. Derivar em
vez de exigir uma variável nova evita o modo de falha mais bobo (subir sem a
env e derrubar a rota); definir `TRACK_SECRET` depois passa a valer e desacopla
a rotação. Conferido: token de descadastro e de sessão são **recusados** pelo
endpoint.

**2. Allowlist de domínio no `?av=`.** `/api/track/click` redireciona para
qualquer http(s) — é o comportamento dele desde sempre. Anexar o token sem
filtrar o destino mandaria a identidade do lead para qualquer site linkado numa
campanha, e o dono daquele site passaria a poder escrever na ficha dele. O
token só é anexado para as origens configuradas.

**3. O que é guardado de cada visita: `path`, `titulo`, `refHost`, `sessao`.**
Nunca a URL completa — ela contém o nosso próprio `?av=`, e gravá-la colocaria
um token que identifica o contato dentro de um evento que a ficha do lead
mostra na tela. Do referrer, só o host.

**4. Uma visita por SESSÃO, não por página.** Índice único parcial em
`contact_events`. Sem isso, quem abre 20 páginas ganharia 20× os pontos e
passaria na frente de quem pediu demonstração — o modelo se corromperia
sozinho. O índice protege o caso acidental (beacon repetido, recarga); contra
quem varia a sessão de propósito, o que responde é o teto por contato.

**5. `lead_score_rules` ganhou `condition` e perdeu o `UNIQUE`.** "Viu preços"
(+10) e "pediu demonstração" (+25) são o **mesmo** `site_event` com pesos
diferentes. Junto veio a correção de um defeito que a fase C tinha deixado:
`calcularConta` montava as regras num `Map` por `eventType`, e `new Map()` com
chave repetida guarda **silenciosamente a última** — a segunda regra sumiria da
conta sem erro, sem log e sem sintoma, deixando só um número errado.

**6. O mapa caminho → evento vive no SERVIDOR** (`site_event_rules`, editável
em `/leads/rastreio`). O endpoint precisa validar o nome contra lista fechada de
qualquer jeito — o script é código do cliente, e um POST forjado manda o nome
que quiser. E **visitar** uma página de intenção gera o evento nomeado: no
plano, "viu a página de preços" é uma visita a `/planos`, não um clique.

**7. Limites falham FECHADOS nesta rota**, invertendo a postura do
`lib/rate-limit.ts` (que é fail-open por ser ferramenta interna). Perder evento
de analytics não custa nada; deixar a enxurrada chegar no Postgres custa o pool
de conexões que a interface logada divide com ela.

**8. A resposta não é um oráculo.** Token inválido, expirado e contato
suprimido respondem a mesma coisa (`{esquecer:true}`), e nada da base sai da
rota — nem nome, nem e-mail, nem "este token é válido".

**9. Eventos de site NÃO entram em `AUTOMATION_TRIGGER_TYPES` nesta fase.**
Gatilho ligado a endpoint público dispara passo de envio, e passo de envio custa
dinheiro real. Duas semanas de dados antes de considerar.

### 7.1 Consentimento — e o modo de falha mais provável da fase

O script é **inerte por padrão**: lê o `av` para a memória, limpa a URL e
enfileira, mas **não persiste nem envia nada** até o site chamar
`av('consentimento', true)`. GPC e DNT bloqueiam mesmo com o aceite. Um "não"
explícito para de coletar até para a memória.

**Isto exige duas coisas de fora do código, e sem elas a fase entrega zero:**

1. O banner de cookies do site precisa chamar `av('consentimento', true)` **em
   toda página**, não só no clique do aceite. O script não guarda a decisão de
   propósito — quem manda no consentimento é o banner, e guardar por conta
   própria faria uma revogação feita lá fora não chegar aqui.
2. O aviso de privacidade do site precisa descrever rastreio de pessoa
   **identificada** (não há fase anônima: o `av` identifica desde o primeiro
   hit), e a base legal é decisão de quem responde pelo jurídico.

Por isso `/leads/rastreio` mostra **"última visita recebida"** e as recusas com
motivo: sem isso, "não aparece lead nenhum" é indistinguível de "está tudo
certo e ninguém visitou", e a fase morre parecendo defeito nosso.

### 7.2 Limites que continuam de pé

- **É identificação de NAVEGADOR, não de pessoa.** Link encaminhado, máquina
  compartilhada. Por isso a visita vale pouco (+3) e nunca serve como prova de
  identidade ou de consentimento.
- **Robô com token legítimo.** Scanner corporativo de e-mail segue o link e
  chega ao site com um `av` válido. Vale notar que isso **já acontece hoje** com
  `email_clicked` — a fase E herda o defeito, não o cria.
- **Limpar o navegador apaga a identificação.** Vale para qualquer ferramenta
  do mercado, inclusive as pagas.
- **A tag pode sumir num tema novo do site** e ninguém perceber por meses. O
  "última visita" é o único alarme, e ele é passivo.

### O mecanismo

```
1. O lead clica num link do nosso e-mail
2. /api/track/click já monta a URL de destino — passa a acrescentar ?av=<token>
3. O script no site lê o `av`, guarda no armazenamento LOCAL do site
   (primeira parte, sem cookie de terceiro)
4. A cada página/evento, o script chama POST /api/track/site com o token
5. O endpoint valida o token → identifica o contato → emite o evento
```

O token é assinado e opaco, no mesmo esquema do link de descadastro
(`lib/jwt.ts`), então não expõe e-mail nem id na URL.

### Os limites, ditos com clareza

- Só é identificado quem **chegou por um link nosso** ou **preencheu um
  formulário**. Quem digita o endereço direto é anônimo até se identificar —
  isso vale para qualquer ferramenta do mercado, inclusive as pagas.
- Limpar o navegador apaga a identificação.
- Exige **colocar um script no site** — é dependência de outra equipe/acesso, e
  por isso está numa fase separada, depois de o score já entregar valor.

---

## 8. A área de gestão de leads

Tela `/leads`, restrita à lista de leads:

- **Lista** com busca e filtros por estágio, **origem/UTM**, faixa de pontuação
  e responsável. Ordenação e paginação reaproveitam o componente do relatório
  de campanha, que já está pronto.
- **Ficha do lead**: dados, origem completa, **linha do tempo dos pontos de
  contato** (de `contact_events`), pontuação com a conta aberta — *por que* ele
  tem 47 pontos — e as automações em que está.
- **Ações**: mudar estágio, atribuir responsável, adicionar tag (dispara
  automação), converter em parceiro (limpa o estágio, move de lista).
- **Painel**: entradas por dia, **por canal de origem** (a pergunta que motivou
  as UTMs), conversão por estágio e distribuição das faixas.

A mudança de estágio também vira evento (`lead_stage_changed`), utilizável como
gatilho.

---

## 9. Segurança e LGPD

| Risco | Tratamento |
|---|---|
| Token vazado | um por origem, revogável, guardado como hash |
| Enxurrada de chamadas | limite por origem (`lib/rate-limit.ts` já existe) |
| Corpo gigante | teto de tamanho → 413 |
| Injeção pelo payload | tudo validado e normalizado; cru só no registro de auditoria |
| Token de rastreio reaproveitado | assinado, ligado ao contato, revogável no descadastro |
| SSRF no webhook de saída | ✅ allowlist + bloqueio por IP + sem redirecionamento (ver 10.1) |

**Consentimento.** Um formulário preenchido **não** é, juridicamente, alguém que
aceitou receber marketing. O `defaults` de cada origem declara explicitamente se
aquele canal capta consentimento, e o padrão é **não presumir**: o lead entra,
é pontuado e aparece na gestão, mas **não recebe campanha** até haver opt-in.

**Rastreio do site.** Acompanhar pessoa identificada exige aviso no site e base
legal. O script deve respeitar o banner de consentimento — e, sem consentimento,
não enviar evento nenhum.

---

## 9.1 O webhook de SAÍDA (fase F)

Passo "Webhook" nas automações: avisa Make/CRM sobre um lead. A direção do
perigo aqui é o inverso da entrada — o risco não é o que chega, é o SERVIDOR
fazer a requisição. Uma URL digitada numa tela que o servidor obedece cegamente
é um SSRF, e a rede interna do Docker (Postgres, Redis) e o serviço de
metadados da nuvem estão a um nome de host de distância.

**Configuração:** `WEBHOOK_SAIDA_HOSTS` no `.env.local` do VPS. Vazia = nenhum
webhook sai. Opcional: `WEBHOOK_SAIDA_SECRET` (sem ela, a chave da assinatura é
derivada do `JWT_SECRET`, como no rastreio).

Três camadas, nenhuma suficiente sozinha (`lib/automations/webhook-saida.ts`):

1. **Allowlist de host.** Igualdade ou subdomínio — `endsWith` puro deixaria
   `make.com.evil.com` passar por `make.com`.
2. **Bloqueio por IP após resolver o DNS.** Cobre o host permitido que um dia
   passe a apontar para dentro, e o domínio próprio apontado para 127.0.0.1.
   Inclui `169.254.169.254`, que é de onde se leem credenciais da máquina.
3. **Sem seguir redirecionamento.** É o furo clássico: a primeira requisição vai
   para o destino permitido, e a segunda para onde ele mandar. Conferido: um 302
   para o endereço de metadados é recusado e o destino do desvio não é chamado.

Só `https`, sem usuário/senha na URL, 5s de timeout, 2 tentativas (4xx não
repete — erro de configuração não melhora com retentativa), e a resposta é lida
com teto e descartada.

**O destino é validado a cada execução**, não só ao salvar o passo: o DNS e a
allowlist do servidor podem ter mudado desde então.

**A chamada é síncrona**, diferente dos passos de envio. O valor de um aviso
está em chegar agora, e o resultado precisa aparecer no relatório da automação
— webhook que falha calado é pior que webhook nenhum, porque cria a impressão
de que o CRM foi avisado. Falha derruba o percurso, com o motivo no log do
passo. No log vai o HOST, nunca a URL inteira: caminhos de webhook do Make
carregam a chave da integração.

**O corpo é contrato**, não detalhe de implementação — quem monta o cenário casa
os campos uma vez. Vai o evento (nome dado ao passo), os dados do contato
(estágio, tags, pontuação, faixa, origem) e **o consentimento de e-mail e
WhatsApp**: mandar o contato sem isso é convidar o outro sistema a falar com
quem não pode. Assinado em `X-Avante-Assinatura`, para o destino confirmar a
origem.

**Risco que sobra:** DNS rebinding. Validamos o endereço ao resolver, e a
conexão resolve de novo — uma janela estreita entre as duas. Fechá-la exigiria
fixar o IP validado na conexão, o que quebra SNI e validação de certificado em
https. Como a allowlist é o controle principal e só quem tem acesso ao sistema
configura a URL, é desproporcional; fica registrado.

`npx tsx scripts/testar-webhook-saida.ts` confere as três camadas sem banco.

## 10. Fases

| Fase | Entrega | Tamanho |
|---|---|---|
| **A** | Endpoint + `webhook_sources` + `webhook_deliveries` + mapeamento + UTMs. Origem cadastrada por script | média ✅ |
| **B** | Campos de lead, lista própria e as três travas da seção 5 | pequena ✅ |
| **D** | Área de Leads + cadastro de origens pela tela (feita ANTES da C, a pedido) | a maior ✅ |
| **C** | Lead Score sobre o que já é capturado + regras + decaimento + faixas | média ✅ |
| **C** | **Lead Score sobre o que já é capturado** (e-mail, WhatsApp, entrada) + regras + decaimento + faixas | média |
| **D** | Tela `/leads` + cadastro de origens + painel por canal | **a maior** |
| **E** | Rastreio do site (script + identificação) — amplia a pontuação | média, com dependência externa ✅ |
| **F** | Passo `webhook` de saída (avisa o Make/CRM) | pequena ✅ |

**A ordem importa.** A fase C vem **antes** do rastreio do site de propósito: o
score já nasce útil com abertura, clique, resposta e origem — sinais que o
sistema **já captura hoje**. Esperar o script do site para só então ter
pontuação seria travar meses de valor numa dependência de outra equipe.

Sugiro fechar **A + B** e ligar um cenário do Make de verdade antes de seguir:
com lead entrando, o formato dos dados deixa de ser suposição.

> As automações (fases 0 a 5) estão **todas em produção** — nada bloqueando
> esta frente.

---

## 11. Decisões tomadas (03/08/2026)

**1. Consentimento na entrada: o lead NÃO recebe campanha até alguém liberar.**
Formulário preenchido não é aceite de marketing. O lead entra, é pontuado e
aparece na gestão, mas fica `subscribed = false` até uma ação explícita —
converter, ou marcar o opt-in na ficha. É o padrão seguro para LGPD e protege
a reputação de envio.

**2. Script no site: viável.** Há acesso a `avantejuntos.com.br`, então a fase
E entra no plano de verdade e o score vai poder incluir visita e eventos do
site, não só os canais próprios.

**3. Demais parâmetros seguem a recomendação deste documento** — todos são
dados, editáveis na tela depois, sem deploy:
- estágios: `novo → contatado → qualificado → convertido/perdido` — **superado
  em 05/08/2026**: viraram as ETAPAS do funil do Pipedrive, cadastráveis na
  tela. Ver "Qualificação e etapa" no ESTADO ATUAL;
- pontuação: a tabela da seção 6.2;
- meia-vida do decaimento: 30 dias;
- responsável: campo existe, atribuição opcional (balcão comum por padrão).

O time vai querer mexer nos pontos depois de ver o score rodando com dados
reais — é esperado, e é por isso que as regras vivem em tabela.
