# Plano — Automações de campanha

Objetivo: o usuário monta um fluxo que roda sozinho por contato, disparado por
tags (e outros eventos), com passos de e-mail, WhatsApp, espera, decisão e
ações sobre o contato.

Este documento é o plano de arquitetura. Não há código escrito ainda.

---

## 1. O que já existe e será reaproveitado

Boa parte da fundação está pronta — o que reduz muito o tamanho do trabalho:

| Peça | Estado | Uso na automação |
|---|---|---|
| BullMQ + Redis | em produção | agendar cada passo, inclusive esperas de dias |
| `worker/email-worker.ts` | em produção | envio de e-mail dentro do fluxo |
| `worker/whatsapp-worker.ts` | em produção | envio de WhatsApp dentro do fluxo |
| Criador de e-mails (`components/builder/`) | em produção | conteúdo do passo "enviar e-mail" |
| Modelos de WhatsApp aprovados | em produção | conteúdo do passo "enviar WhatsApp" |
| `campaign_sends` + webhook + rastreio | em produção | entrega, abertura, clique, leitura |
| `contacts.tags` (array de texto) | em produção | alvo dos gatilhos |
| Arrastar do Criador de e-mails | em produção | mesmo padrão na tela da automação |

**Não é preciso biblioteca nova.** O projeto não tem `react-flow` nem `@dnd-kit`,
e a seção 7 explica por que continua sem precisar.

---

## 2. A peça que falta: eventos

Este é o ponto que decide o cronograma. Hoje **a tag é gravada em bloco**:

```ts
// app/api/contacts/[id]/route.ts
updates.tags = normalizeTags(body.tags);
```

O sistema sabe o estado final (`["lead", "quente"]`), mas **não sabe o que mudou**.
Um gatilho "quando a tag X for adicionada" é impossível sem essa informação.

**Solução: um pequeno registro de eventos (padrão outbox).**

Antes de gravar, compara o array antigo com o novo e emite um evento por
diferença. O mesmo vale para lista, abertura, clique e resposta.

```ts
// lib/events.ts (novo)
await emitContactEvent("tag_added", contactId, { tag: "lead-quente" });
```

A função faz duas coisas, na mesma transação da alteração:
1. grava em `contact_events` (auditoria e reprocessamento);
2. enfileira um job que confere o evento contra os gatilhos ativos.

**Onde instrumentar** (são poucos pontos, todos já existentes):

| Arquivo | Evento |
|---|---|
| `app/api/contacts/[id]/route.ts` | `tag_added`, `tag_removed`, `list_subscribed`, `list_unsubscribed` |
| `app/api/contacts/route.ts` (POST) | `contact_created`, `tag_added` |
| `app/api/contacts/import/route.ts` | idem, em lote |
| `app/api/track/open/route.ts` | `email_opened` |
| `app/api/track/click/route.ts` | `email_clicked` |
| `app/api/unsubscribe/route.ts` | `list_unsubscribed` |
| `app/api/webhooks/whatsapp/route.ts` | `whatsapp_replied`, `whatsapp_read` |

> Gravar o evento **antes** de processá-lo é o que permite corrigir um gatilho
> quebrado e reprocessar sem perder nada.

---

## 3. Modelo de dados

```
automations
  id, name, description
  status            'draft' | 'active' | 'paused' | 'archived'
  entry_policy      'once' | 'always'      -- pode reentrar?
  created_by_user_id, created_at, updated_at

automation_triggers                        -- VÁRIOS por automação
  id, automation_id
  type              'tag_added' | 'tag_removed' | 'list_subscribed'
                    | 'list_unsubscribed' | 'email_opened' | 'email_clicked'
                    | 'whatsapp_replied' | 'contact_created' | 'manual'
  config jsonb      { tag: 'lead-quente' } | { listId } | { campaignId? }

automation_steps                           -- a árvore do fluxo
  id, automation_id
  parent_id         null = primeiro passo
  branch            'main' | 'yes' | 'no'  -- caminho do pai
  position          int                    -- ordem entre irmãos
  type              'send_email' | 'send_whatsapp' | 'wait' | 'if_else'
                    | 'add_tag' | 'remove_tag' | 'subscribe_list'
                    | 'unsubscribe_list' | 'update_field' | 'webhook' | 'end'
  config jsonb

automation_runs                            -- um contato percorrendo o fluxo
  id, automation_id, contact_id
  current_step_id, status  'running' | 'waiting' | 'done' | 'stopped' | 'failed'
  next_run_at       espelha o delay do BullMQ (ver seção 4)
  steps_executed    int — trava de laço infinito
  entered_at, finished_at

automation_run_steps                       -- log por passo: auditoria e métricas
  id, run_id, step_id, status, result jsonb, at

contact_events                             -- outbox da seção 2
  id, contact_id, type, payload jsonb, created_at, processed_at
```

**Por que `parent_id + branch + position`** em vez de `next_step_id`: a tela
insere passos *entre* dois existentes (o botão "+" do print). Com ponteiro
encadeado, inserir exige reescrever vizinhos; com posição, é só deslocar. E a
ramificação do Se/Então vira naturalmente dois grupos de filhos (`yes` e `no`).

---

## 4. Motor de execução

Um worker novo (`worker/automation-worker.ts`) e uma fila `automation-runs`.
Cada job avança **um passo de um contato**:

```
1. carrega o run e o passo atual
2. executa o passo conforme o tipo
3. grava em automation_run_steps
4. decide o próximo passo (com o resultado, no caso do Se/Então)
5. enfileira o próximo job — com delay, se o passo for "Aguarde"
```

A espera de "2 dias" é um job com `delay` — o BullMQ já faz isso, é o mesmo
mecanismo do agendamento de campanha que está em produção.

### O risco que precisa ser tratado

Um job de 2 dias fica **guardado no Redis**. Se o Redis for perdido ou
esvaziado, as automações em espera somem sem aviso — e ninguém percebe, porque
não há erro: simplesmente nada acontece.

**Mitigação:** `automation_runs.next_run_at` no Postgres espelha o agendamento,
e uma tarefa periódica reenfileira o que estiver vencido e sem job. O Postgres
vira a fonte da verdade; o Redis, só o despachante.

---

## 5. Gatilhos de entrada

Vários por automação, como no anexo. Ao receber um evento, o motor:

1. busca gatilhos ativos que casem com o tipo e a configuração;
2. aplica a `entry_policy` (se `once`, ignora quem já entrou);
3. cria o `automation_run` e enfileira o primeiro passo.

Primeira leva: `tag_added`, `tag_removed`, `list_subscribed`, `contact_created`
e `manual`. Abertura, clique e resposta entram depois — dependem dos mesmos
eventos, mas são menos usados como *entrada*.

---

## 6. Ações disponíveis

| Grupo | Ação | Observação |
|---|---|---|
| **Envio** | Enviar e-mail | conteúdo no Criador de e-mails, por passo |
| | Enviar WhatsApp | modelo aprovado + mapa de variáveis |
| **Fluxo** | Aguarde | por tempo, até data, ou até condição |
| | Se/Então | ramifica em `yes`/`no` |
| | Webhook | POST dos dados do contato |
| | Fim | encerra o percurso |
| **Contato** | Adicionar / remover tag | ⚠️ realimenta gatilhos — ver seção 8 |
| | Inscrever / cancelar inscrição em lista | |
| | Atualizar campo | |

### A decisão de arquitetura mais importante

Os envios da automação devem gravar em **`campaign_sends`**, e não numa tabela
nova. Basta tornar `campaign_id` anulável e acrescentar `automation_run_id` e
`automation_step_id`.

O motivo é concreto: o webhook do WhatsApp casa a confirmação pelo
`provider_message_id` **nessa tabela**, e o custo consolidado do Dashboard, o
rastreio de abertura e o descadastro leem **dessa tabela**. Reaproveitando-a,
entrega, leitura, custo e relatório da automação funcionam **sem tocar em uma
linha** desse código. Numa tabela separada, seria preciso duplicar os quatro.

Esse é também o caminho para as métricas por passo que aparecem no anexo
("231 enviados · 25,5% de abertura"): um `join` de `automation_run_steps` com
`campaign_sends`.

---

## 7. A tela: o que construir e o que evitar

**Recomendação: não usar canvas livre** (`react-flow` e similares).

Olhando o anexo, a automação do Active Campaign é uma **coluna vertical** com
botões "+" entre os passos — não um grafo espalhado. Um canvas livre custaria
uma dependência pesada, posições `x/y` para guardar, zoom, minimapa e um
comportamento ruim no celular; tudo para renderizar uma lista.

**O que construir:**

- coluna vertical de passos, com "+" entre eles (insere no `position`);
- Se/Então abre duas colunas, com os filhos `yes` e `no`;
- **arrastar para reordenar**, com o mesmo padrão nativo já usado no Criador de
  e-mails (`draggable` + `dataTransfer` em `components/builder/canvas.tsx`) —
  zero dependência nova e visual consistente com o resto do sistema;
- painel lateral para configurar o passo selecionado, como no Criador.

Ou seja: continua sendo arrastar e soltar, só que num trilho — que é o que o
fluxo realmente é.

---

## 8. Travas de segurança

Automação erra em silêncio e em escala. Três travas obrigatórias:

**1. Laço infinito.** A automação A adiciona a tag que dispara a automação A.
É o erro mais fácil de cometer e o mais caro: manda mensagem em looping e gasta
dinheiro real. Travas: `steps_executed` com teto por percurso, e recusar salvar
uma automação cujo gatilho case com uma ação dela mesma.

**2. Elegibilidade, sempre.** Todo envio revalida consentimento no momento do
disparo — quem pediu para sair não recebe, ainda que já esteja no meio do
fluxo. Mesma regra que já vale nas campanhas.

**3. Limite e custo.** O WhatsApp tem teto de conversas por 24h e cada mensagem
é cobrada. A automação precisa: respeitar o limite (a fila já tem controle de
vazão), e mostrar o custo acumulado por automação, como já existe por campanha.

E uma trava de operação: **modo de teste** — rodar o fluxo com um contato só,
sem enviar de verdade, mostrando o que aconteceria em cada passo.

---

## 9. Fases sugeridas

Cada fase entrega algo usável e vai para produção sozinha.

| Fase | Entrega | Tamanho |
|---|---|---|
| **0** | Eventos (seção 2) + tabela `contact_events` + instrumentação | pequena |
| **1** | Modelo de dados + motor + passos `wait`, `add_tag`, `remove_tag`, listas. Sem tela: automação criada por API/seed | média |
| **2** | Passos de envio (e-mail e WhatsApp) + `campaign_sends` genérica | média |
| **3** | `if_else` e a árvore de ramificação | média |
| **4** | A tela: coluna de passos, "+", arrastar, painel lateral | **a maior** |
| **5** | Relatório por automação e por passo + custo | pequena |

Ordem proposital: a fase 4 é a maior, e ela ficar por último significa que o
motor já estará provado quando a tela for construída. Montar tela sobre motor
não testado é o caminho mais rápido para retrabalho.

Sugiro **fechar a fase 0 e a 1 antes de decidir o resto** — depois do motor
rodando, o tamanho real das outras fases fica muito mais claro.

---

## 10. Decisões em aberto

Precisam da sua resposta antes da fase 1:

1. **Reentrada:** um contato pode entrar duas vezes na mesma automação? Sugiro
   `once` como padrão, com opção de permitir.
2. **Contato descadastrado no meio do fluxo:** para tudo, ou continua os passos
   que não enviam (tag, campo)? Sugiro parar tudo — mais simples de explicar.
3. **Editar automação ativa:** o que acontece com quem já está no meio dela?
   Sugiro versionar: quem entrou segue a versão antiga, novos usam a nova.
4. **Limite de automações ativas** por vez, para conter custo enquanto a
   equipe aprende a ferramenta.
