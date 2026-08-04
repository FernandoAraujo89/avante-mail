# Plano — Gestão de leads, entrada por webhook e Lead Score

Objetivo: capturar leads de fora (Make, formulários, anúncios) com a **origem
completa** (UTMs), mantê-los numa **lista própria**, e pontuá-los conforme os
pontos de contato com os canais da Avante.

---

## ▶ ESTADO ATUAL (04/08/2026)

**Fases A e B prontas.** A próxima é a **fase C** (Lead Score).

| Fase | Situação | Commit |
|---|---|---|
| A — Entrada por webhook + UTMs | ✅ produção | `1984395` |
| — Correção do consentimento | ✅ produção | `5060116` |
| B — Campos de lead + travas | ✅ feita | |
| C — Lead Score | ⬜ **próxima** | |
| D — Tela `/leads` | ⬜ | |
| E — Rastreio do site | ⬜ | |
| F — Webhook de saída | ⬜ | |

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
2. O seletor de destinatários **exclui a lista de leads por padrão**, com opção
   explícita para incluí-la.
3. A tela de Contatos ganha filtro visível de estágio.

Ver o resumo da implementação no ESTADO ATUAL, no topo. Duas decisões que só
apareceram ao construir:

- a trava 2 vale por **contato** (`stage`), não por lista — então ela também
  pega o lead escolhido a dedo no passo Destinatários, que era o furo óbvio;
- escolher a lista de leads **não** libera o envio sozinho; a tela avisa em vez
  de deixar o público sair vazio sem explicação.

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

## 7. Rastreio do site (a parte difícil)

O problema não é registrar a visita; é **saber de quem ela é**. O site
(`avantejuntos.com.br`) e o sistema (`campanhas.avantetools.com.br`) são
domínios diferentes, e cookie de terceiro não existe mais.

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
| SSRF no webhook de saída | lista de destinos permitidos + bloqueio de rede interna |

**Consentimento.** Um formulário preenchido **não** é, juridicamente, alguém que
aceitou receber marketing. O `defaults` de cada origem declara explicitamente se
aquele canal capta consentimento, e o padrão é **não presumir**: o lead entra,
é pontuado e aparece na gestão, mas **não recebe campanha** até haver opt-in.

**Rastreio do site.** Acompanhar pessoa identificada exige aviso no site e base
legal. O script deve respeitar o banner de consentimento — e, sem consentimento,
não enviar evento nenhum.

---

## 10. Fases

| Fase | Entrega | Tamanho |
|---|---|---|
| **A** | Endpoint + `webhook_sources` + `webhook_deliveries` + mapeamento + UTMs. Origem cadastrada por script | média ✅ |
| **B** | Campos de lead, lista própria e as três travas da seção 5 | pequena ✅ |
| **C** | **Lead Score sobre o que já é capturado** (e-mail, WhatsApp, entrada) + regras + decaimento + faixas | média |
| **D** | Tela `/leads` + cadastro de origens + painel por canal | **a maior** |
| **E** | Rastreio do site (script + identificação) — amplia a pontuação | média, com dependência externa |
| **F** | Passo `webhook` de saída (avisa o Make/CRM) | pequena |

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
- estágios: `novo → contatado → qualificado → convertido/perdido`;
- pontuação: a tabela da seção 6.2;
- meia-vida do decaimento: 30 dias;
- responsável: campo existe, atribuição opcional (balcão comum por padrão).

O time vai querer mexer nos pontos depois de ver o score rodando com dados
reais — é esperado, e é por isso que as regras vivem em tabela.
