# Plano — Automações de campanha

Objetivo: o usuário monta um fluxo que roda sozinho por contato, disparado por
tags (e outros eventos), com passos de e-mail, WhatsApp, espera, decisão e
ações sobre o contato.

---

## ▶ ESTADO ATUAL (03/08/2026)

**Todas as fases (0 a 5) estão EM PRODUÇÃO** — verificado em 03/08/2026: a
migração `migrate-campaign-sends-origem.ts` está aplicada, `/automations`
responde e há automação cadastrada. O plano está completo; o que sobra é
`update_field` e `webhook`, que nunca tiveram fase marcada. O passo `webhook`
de saída está planejado em `docs/plano-webhooks-leads.md` (fase F).

| Fase | Situação | Commit |
|---|---|---|
| 0 — Eventos | ✅ produção | `4bd0c62` |
| 1 — Motor | ✅ produção | `2f9d39d` |
| 2 — Envios | ✅ produção | `fcbfa1d` |
| 3 — Se/Então | ✅ produção | `531360b` |
| 4 — Tela | ✅ produção | `d3d7108` |
| 5 — Relatórios | ✅ produção | `bb2e42a` |

**O que já roda:** `contact_events` registra o que muda no contato (7 pontos
instrumentados); `worker/automation-worker.ts` consome os eventos, abre
percursos e executa os passos `wait`, `add_tag`, `remove_tag`,
`subscribe_list`, `unsubscribe_list`, `send_email`, `send_whatsapp`, `if_else`
e `end`. `lib/automations/engine.ts` concentra a lógica do fluxo,
`lib/automations/envios.ts` a dos envios e `lib/automations/condicoes.ts` a das
condições. Serviço `automation-worker` no compose.

Faltam só `update_field` e `webhook` — sem fase marcada; o motor recusa os dois
com mensagem clara.

**Migração da fase 2** (`scripts/migrate-automation-sends.ts`) já aplicada em
produção — o `deploy.sh` roda todo `scripts/migrate-*.ts` antes de subir o app.
Atenção: o deploy sincroniza o **diretório de onde é chamado**, e roda a partir
do Mac (ele é quem faz o ssh) — chamado do lugar errado, ele sobe uma versão
antiga sem erro nenhum, e a migração "não roda" porque nem chegou lá.

### Como funciona o envio (fase 2)

O passo grava em **`campaign_sends`** (a mesma tabela das campanhas) e
enfileira nas filas de sempre — `email-sends` e `whatsapp-sends`. Os workers
ganharam um segundo caminho: quando `campaign_id` é nulo, o conteúdo vem do
config do passo. Com isso entrega, abertura, leitura, descadastro e custo já
valem para a automação, sem código novo.

O percurso **não espera a entrega**: enfileirou, segue para o próximo passo.
Quem controla intervalo é o "Aguarde".

Config dos passos:

```jsonc
// send_email — mjmlContent é a fonte da verdade; templateId é a alternativa,
// resolvida no momento do envio.
{ "subject": "Bem-vindo", "preheader": "…", "mjmlContent": "<mjml>…</mjml>" }
{ "subject": "Bem-vindo", "templateId": "<uuid de templates>" }

// send_whatsapp — modelo aprovado + mapa de variáveis, igual ao da campanha.
{ "whatsappTemplateId": "<uuid>", "variables": { "1": { "source": "name" } } }
```

Colunas novas em `campaign_sends`: `automation_run_id`, `automation_step_id`,
`channel` e `campaign_id` **anulável** (com `CHECK` exigindo uma das duas
origens).

**Como testar:** `npx tsx scripts/seed-automation-envio.ts` cria uma automação
ativa (gatilho: tag "boas-vindas"; fluxo: e-mail → WhatsApp, se houver modelo
aprovado → aguarda 2min → +boas-vindas-enviado → fim). `… remover` apaga.
⚠️ Com o worker no ar, marcar um contato com essa tag **envia de verdade**.
(`seed-automation-teste.ts` continua sendo o teste do motor sem envio.)

### Como funciona o Se/Então (fase 3)

**Não precisou de migração** — `parent_id + branch + position` já estavam no
modelo desde a fase 1, esperando exatamente por isto.

O passo decide o ramo e o percurso **entra nele**: o próximo passo é o primeiro
filho com `branch = 'yes'` ou `'no'`. Ramos **não se reencontram** — o fim de um
ramo é o fim do percurso, então o "senão" precisa ser montado por inteiro. Ramo
vazio encerra o percurso como `done`, sem travar.

```jsonc
// config do passo if_else
{
  "match": "all",                       // "all" (padrão) ou "any"
  "conditions": [
    { "type": "has_tag", "tag": "vip" },
    { "type": "email_opened", "stepId": "<passo de envio>", "negate": true }
  ]
}
```

Condições: `has_tag`, `in_list`, `email_opened`, `email_clicked`,
`whatsapp_replied`, `whatsapp_subscribed`, `field_equals`. Qualquer uma aceita
`"negate": true`.

Abertura, clique e resposta olham os envios **deste percurso**
(`campaign_sends.automation_run_id`) — é o que a fase 2 destravou, e é o que
permite o fluxo clássico "manda o e-mail → aguarda 2 dias → abriu?". Com
`stepId`, olha um passo específico; sem ele, qualquer envio do percurso.

O log do passo grava o ramo escolhido **e o resultado de cada condição**
(`{"ramo":"no","detalhes":[…]}`), que é o que responde "por que este contato
foi parar nesse lado?" sem precisar reproduzir o percurso.

**Como testar:** `npx tsx scripts/seed-automation-condicao.ts` cria o fluxo
"tem a tag vip? → +rota-vip, senão +rota-comum". Não envia nada — dá para
exercitar os dois lados só mexendo nas tags.

### A tela (fase 4)

`/automations` lista e `/automations/[id]` edita. **Sem migração** — a fase 4 é
só tela e API.

- **Coluna vertical com "+" entre os passos**, e o Se/Então abrindo as colunas
  "Sim" e "Não" (`components/automations/step-tree.tsx`). Nada de canvas livre:
  o fluxo é um trilho, não um grafo — sem dependência nova, sem x/y para
  guardar, e funciona no celular.
- **Arrastar para reordenar** com `draggable` + `dataTransfer`, o mesmo padrão
  nativo do Criador de e-mails. Dá para mover entre ramos; soltar um Se/Então
  dentro do próprio ramo é recusado (viraria ciclo).
- **Painel lateral** configura o passo selecionado, reaproveitando o
  `DesignEditor` (e-mail do passo) e o `WhatsAppMessageStep` (modelo +
  variáveis) das campanhas.
- A coluna **termina no Se/Então**: como nada roda depois dele, a tela não
  oferece "+" abaixo. Um Se/Então inserido no MEIO da coluna leva os passos que
  estavam abaixo dele para o lado "Sim" (com aviso na tela) — deixá-los onde
  estavam criaria trecho morto, e apagá-los seria pior.
- Passo inalcançável que já exista **aparece na tela**, apagado e com o motivo,
  para poder ser arrastado ou removido. Esconder um passo que a validação acusa
  deixa o usuário sem como consertar o que a mensagem está pedindo.

**Rascunho pela metade pode ser salvo; ativar é que exige fluxo válido.** Quem
edita um fluxo grande não o termina de uma vez — mas automação erra em silêncio
e em escala, então a hora de barrar é a de ligar. `lib/automations/validacao.ts`
é a fonte única: as mesmas funções que o motor usa para ler o config (
`lerConfigDeEmail`, `lerCondicoes`…) são as que validam a tela, então não existe
"a tela deixou salvar e o motor recusou".

### O relatório (fase 5)

`/automations/[id]/report`, com atalho na lista e no editor. **Sem migração
nova** para os números — eles saem do que as fases 1 e 2 já gravavam.

Duas perguntas, dois caminhos:

- **"onde os contatos estão AGORA?"** → `automation_runs.current_step_id`. Vira
  a seção *Onde os contatos estão*, com barra proporcional à maior fila: o
  gargalo salta à vista. Os mesmos números aparecem **no cartão de cada passo
  do editor** ("3 aqui agora · 12 passaram · 40% abertura"), porque é ali que a
  pergunta nasce.
- **"o que já aconteceu?"** → `automation_run_steps` (quem executou cada passo)
  e `campaign_sends` (enviado, entregue, aberto, clicado, respondido e custo).

Os passos saem na ordem em que o contato os percorre (tronco, depois o lado
"Sim" inteiro, depois o "Não"), com indentação por profundidade — ordenar por
`position` cru misturaria ramo e tronco, porque cada grupo começa do zero.

As métricas **por passo** valem para a versão corrente; o resumo cobre todas.
Percursos que entraram por versões anteriores aparecem contados à parte.

O histórico do contato também passou a mostrar envio de automação (era
`innerJoin` com campanha, então o contato recebia a mensagem e a ficha dele não
mostrava nada).

Barrado na ativação: passo sem configuração, ramo vazio, passo inalcançável,
**laço** (gatilho que casa com uma ação da própria automação) e o **teto de 5
ativas** (`app_settings.automations_max_active`, mudável sem deploy).

**Salvar uma automação em uso cria uma versão nova** — quem está no meio do
fluxo termina pela versão em que entrou. Rascunho é reescrito no lugar.

**Armadilhas já pagas (não repetir):**
- O BullMQ **recusa `:` no jobId** — o identificador usa `__`.
- Percurso recém-criado nasce com `next_run_at = agora` de propósito: se o
  processo morrer entre criar e enfileirar, a reconciliação o encontra. Sem
  isso ele fica parado para sempre, **sem erro nenhum**.
- A reconciliação cobre `waiting` **e** `running`: o job pode se perder
  durante a espera ou entre dois passos.
- **Um passo de envio manda uma vez por percurso** — garantido pelo índice
  único parcial `campaign_sends_automacao_passo_idx`, não por checagem em
  memória. O retry do BullMQ depois de gravar o envio e antes de avançar o
  percurso mandaria a mesma mensagem duas vezes (dinheiro real).
- Ao reencontrar o envio já gravado, o motor **reenfileira se ainda estiver
  `pending`** em vez de ignorar. Ignorar deixaria o envio parado para sempre
  no caso em que o processo morre entre gravar e enfileirar.
- O **canal fica na linha do envio** (`campaign_sends.channel`), não deduzido
  por join. Custo do mês não pode depender de uma campanha/passo que talvez
  já tenha sido apagado.
- WhatsApp sem consentimento/telefone **pula o passo** (log `skipped`) em vez
  de derrubar o percurso — um fluxo com e-mail e WhatsApp continua valendo
  pelo e-mail. Já modelo inexistente ou não aprovado **falha**, porque é erro
  de configuração, não característica do contato.
- Se/Então **sem condição válida falha o percurso** em vez de assumir um lado.
  Chutar um ramo manda a mensagem errada para o grupo errado, calado.
- Mudar o estado dentro do `dragstart` faz o Chrome **cancelar o arraste** — as
  zonas de soltura só aparecem depois de um `setTimeout(…, 0)`. Mesma pedra já
  paga no Criador de e-mails.
- Os problemas mostrados na tela são os do **último salvamento** (a validação
  vive no servidor, junto do motor). Editar limpa os avisos em vez de deixá-los
  contradizendo o que o usuário acabou de corrigir.
- A restrição `campaign_sends_origem_check` e o `ON DELETE SET NULL` do
  percurso **se contradiziam**: apagar uma automação que já tinha enviado
  zerava o `automation_run_id` e a linha passava a violar a própria restrição,
  então o DELETE morria com erro de constraint. Corrigido em
  `migrate-campaign-sends-origem.ts` — a restrição aceita também o
  `automation_step_id`, que fica na linha e mantém o histórico de custo em pé.

**No deploy destas fases:** roda a migração
`scripts/migrate-campaign-sends-origem.ts` (o `deploy.sh` já varre
`migrate-*.ts`). O resto — fases 3, 4 e 5 — é só código.

---

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
`automation_step_id` (na prática entrou também `channel`, para o custo do mês
não depender de um join com a campanha/passo que pode ter sido apagado).

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

## 10. Decisões tomadas

Definidas em 03/08/2026:

**1. Reentrada: não.** Um contato entra uma vez em cada automação. Simplifica
o modelo (`automation_runs` ganha índice único por automação + contato, que
vira a própria trava contra entrada duplicada por eventos repetidos) e é a
proteção mais barata contra mandar a mesma sequência duas vezes para alguém.

**2. Descadastro no meio do fluxo: para tudo.** O percurso vai para `stopped`
e nenhum passo seguinte roda — nem os que não enviam. É o comportamento que
respeita o pedido do contato sem exigir que alguém entenda a regra.

**3. Automação ativa é versionada.** Editar uma automação em uso cria uma nova
versão; quem já está dentro termina pela versão em que entrou. Sem isso, mexer
no fluxo enquanto centenas de pessoas o percorrem produz percursos
incoerentes — o contato receberia o passo 5 de um fluxo que já não existe.

> Implicação no modelo: `automations` ganha `version` e as tabelas de passos
> passam a apontar para a versão, não para a automação. `automation_runs`
> guarda a versão em que o contato entrou.

**4. Limite de automações ativas: sim.** Teto de **5 ativas** ao mesmo tempo,
guardado em `app_settings` (mesma mecânica da lista do Avante News), para
mudar sem deploy. Passar do teto exige pausar outra — trava barata contra
custo inesperado enquanto a equipe aprende a ferramenta.
