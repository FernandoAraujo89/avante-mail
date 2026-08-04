# Plano — Recebimento de leads por webhook (Make e outras plataformas)

Objetivo: o sistema passa a **receber dados de fora** por webhook (leads do
Make, de formulários, de anúncios) e a **avisar o mundo lá fora** quando algo
acontece aqui. Com uma área para acompanhar esses leads.

Documento de arquitetura. Nada foi alterado no código.

---

## 1. Antes de tudo: a documentação linkada é de outra API

O link enviado — `developers.make.com/api-documentation` — é a **API de gestão
do Make**: serve para criar, listar e executar cenários programaticamente,
autenticando com um token de usuário.

**Para receber leads do Make, não precisamos dela.** O caminho é o contrário:
o cenário do Make usa o módulo **HTTP** para fazer um POST na nossa URL. Quem
publica o endpoint somos nós; o Make só chama.

Isso é uma boa notícia: sem token do Make para guardar, sem integração para
manter, sem quebrar quando eles mudarem a API. E o mesmo endpoint serve para
**qualquer** plataforma que saiba fazer um POST — RD Station, Typeform, um
formulário do site, n8n, Zapier.

A API de gestão só faria sentido num cenário bem diferente (nosso sistema
criando cenários no Make sozinho), que não é o que foi pedido.

### O que o Make faz e o que não faz

| | Comportamento | Consequência para nós |
|---|---|---|
| Cabeçalhos | O módulo HTTP envia cabeçalhos personalizados | Autenticação por token no cabeçalho resolve — simples e suficiente |
| Repetição | **Não repete sozinho**; a repetição é configurada no cenário | Um cenário mal configurado (ou rodado de novo à mão) manda o mesmo lead duas vezes — **a idempotência é problema nosso** |
| Tempo limite | 1–300s, padrão 40s | Dá para responder de forma síncrona e devolver um resultado de verdade |

---

## 2. O que já existe e será reaproveitado

Boa parte do trabalho pesado está pronta:

| Peça | Onde | Uso aqui |
|---|---|---|
| Rota pública de webhook | `middleware.ts` já libera `/api/webhooks/` | o endpoint novo entra sem mexer em autenticação |
| Verificação de assinatura | `lib/whatsapp/webhook.ts` (HMAC, `timingSafeEqual`) | padrão de segurança já existente para reaproveitar |
| Contato com deduplicação | `contacts` — e-mail e telefone são únicos | lead repetido não vira contato duplicado |
| Normalização de telefone | `lib/phone.ts` (E.164, casamento por sufixo) | telefone vindo de qualquer formato |
| Eventos e automações | `contact_events` + motor das automações | **um lead que entra já pode disparar uma automação, sem nada novo** |

Esse último item é o mais valioso: assim que o lead vira contato com uma tag,
o motor que já está em produção cuida da nutrição. Não há motor novo a
construir.

> ⚠️ **Pendência que afeta o cronograma:** as fases 3, 4 e 5 das automações
> estão commitadas e **ainda não deployadas** (ver `docs/plano-automacoes.md`).
> Vale subir antes de começar isto, para não empilhar duas frentes não
> publicadas.

---

## 3. A decisão central: lead é um contato ou uma entidade nova?

**Recomendação: lead é um contato**, com campos novos — não uma tabela à parte.

O motivo é que tudo que um lead precisa já existe em cima de `contacts`:
deduplicação por e-mail/telefone, tags, consentimento, descadastro, envio de
e-mail e WhatsApp, e os gatilhos de automação. Numa tabela separada, cada uma
dessas coisas teria de ser reconstruída — e um lead que vira parceiro viraria
**duas identidades** da mesma pessoa, com históricos separados.

Campos novos em `contacts`:

```
stage        'novo' | 'contatado' | 'qualificado' | 'convertido' | 'perdido'
             NULL = não é lead (é parceiro/contato comum)
source       'make' | 'formulario' | 'importacao' | … (de onde veio)
sourceDetail texto livre (nome do cenário, campanha, formulário)
ownerUserId  responsável pelo acompanhamento
```

### O risco desta escolha, e como tratá-lo

Misturar leads com os 1.458 parceiros na mesma tabela cria um perigo real:
alguém monta uma campanha, deixa "todas as listas" e **dispara para os leads
sem querer**. Isso custa dinheiro e queima a base.

Três travas, todas obrigatórias:

1. Lead entra numa **lista própria** ("Leads"), nunca nas listas de parceiros.
2. O seletor de destinatários **exclui leads por padrão**, com uma opção
   explícita para incluí-los.
3. A tela de Contatos ganha um filtro visível de estágio, para nunca haver
   dúvida sobre quem está olhando.

Se preferir a separação total (tabela própria), é possível — mas então leads
não recebem automação, não são deduplicados contra parceiros e precisam de
consentimento próprio. É bem mais caro pelo que entrega.

---

## 4. Recebimento (Make → nós)

### O endpoint

```
POST /api/webhooks/entrada/{slug}
```

Um `slug` por origem, para dar para revogar uma sem derrubar as outras e para
saber de onde cada lead veio sem adivinhação.

### Autenticação

Duas camadas, e a segunda é opcional:

1. **Token no cabeçalho** — `Authorization: Bearer <token>`. Guardamos só o
   hash, como já é feito com os tokens de redefinição de senha. É o que o Make
   configura em dois cliques.
2. **Assinatura HMAC** — para origens que suportem, reaproveitando
   `verifySignature`. Fica desligada por padrão: exigir do Make complica sem
   ganho real, já que o token viaja por HTTPS.

### Cadastro de origens (sem código para cada nova)

Tabela `webhook_sources`:

```
id, name, slug, tokenHash, secret (HMAC, opcional),
mapping jsonb, defaults jsonb, active, createdAt, lastSeenAt
```

`mapping` diz de onde tirar cada campo do payload — o mesmo conceito da
importação de CSV, que a equipe já conhece:

```jsonc
{
  "name":  "data.nome",           // aceita caminho com ponto
  "email": "data.email",
  "phone": "data.telefone",
  "company": "data.empresa"
}
```

`defaults` aplica o que não vem no payload:

```jsonc
{ "tags": ["lead", "make"], "stage": "novo", "listId": "<uuid da lista Leads>" }
```

Assim, ligar uma origem nova (Typeform, RD, outro cenário) é **cadastro na
tela**, não deploy.

### O que acontece a cada chamada

```
1. valida o token da origem            → 401 se não bater
2. valida o tamanho do corpo            → 413 acima do teto
3. grava a entrega crua (auditoria)     → webhook_deliveries
4. aplica o mapeamento                  → nome, e-mail, telefone…
5. valida e normaliza (e-mail, E.164)   → 422 com o motivo, se inválido
6. procura contato por e-mail/telefone  → cria ou atualiza
7. aplica tags, lista e estágio padrão
8. emite os eventos (contact_created / tag_added)
9. responde 200 com o que foi feito
```

O passo 8 é o que faz o lead **cair direto na automação de nutrição** — sem
nenhuma peça nova.

Resposta útil para quem depura no Make:

```jsonc
{ "ok": true, "acao": "criado", "contactId": "…", "tags": ["lead","make"] }
{ "ok": true, "acao": "atualizado", "contactId": "…" }
{ "ok": false, "erro": "e-mail inválido", "campo": "data.email" }
```

### Idempotência — a parte que mais dá problema

Como o Make não repete sozinho **mas o cenário pode ser rodado de novo**, o
mesmo lead chega duas vezes com frequência. Três defesas:

1. **Deduplicação por identidade**: e-mail (ou telefone) já existente vira
   atualização, nunca contato novo. Isso sozinho resolve a maioria.
2. **Chave externa opcional**: se a origem mandar um `externalId`, guardamos e
   ignoramos a repetição explicitamente.
3. **Janela curta**: entrega idêntica (mesmo hash de corpo) na mesma origem
   dentro de alguns minutos é respondida com `200 { "acao": "ignorado" }` —
   evita a tempestade de um cenário em laço.

### Registro das entregas

Tabela `webhook_deliveries` (id, sourceId, payload cru, status, resultado,
erro, createdAt). É o que permite responder "esse lead chegou?" sem depender
do histórico do Make, e reprocessar quando um mapeamento estiver errado.

Com expurgo automático (90 dias), senão a tabela cresce sem fim.

---

## 5. Envio (nós → Make): o passo que já está esperando

O passo `webhook` **já está declarado** em `AUTOMATION_STEP_TYPES` e o motor o
recusa com "ainda não implementado". Implementá-lo fecha o ciclo:

```
Lead entra pelo Make → automação nutre → lead responde/clica
                                          → passo "webhook" avisa o Make
                                          → Make joga no CRM / avisa o vendedor
```

Config do passo:

```jsonc
{
  "url": "https://hook.us2.make.com/xxxxxxxx",
  "method": "POST",
  "headers": { "X-Origem": "campanhas-avante" },
  "incluir": ["name", "email", "phone", "tags", "stage"]
}
```

Cuidados obrigatórios (é uma chamada externa dentro de um fluxo automático):

- **tempo limite curto** (10s) — sem isso um endpoint lento trava o percurso;
- **repetição com espera crescente**, reaproveitando o retry do BullMQ;
- **lista de destinos permitidos**, ou ao menos bloqueio de IPs internos:
  um passo de webhook apontando para `localhost` ou para a rede interna do VPS
  é um pedido de SSRF vindo de dentro de casa;
- **nunca mandar dado sensível por padrão** — daí o `incluir` explícito, em vez
  de despejar o contato inteiro.

---

## 6. A área de gestão de leads

Tela `/leads`, sobre os mesmos contatos, filtrada por `stage`:

- **Lista** com busca, filtro por estágio, origem e responsável, e a mesma
  paginação/ordenação já usada no relatório de campanha (componente pronto).
- **Ficha do lead**: dados, origem, histórico de campanhas (já existe na ficha
  do contato) e as automações em que ele está.
- **Ações**: mudar estágio, atribuir responsável, adicionar tag (o que dispara
  automação), converter em parceiro (limpa o estágio e move de lista).
- **Painel simples**: entradas por dia, por origem, e conversão por estágio.

A mudança de estágio deve virar **evento** (`lead_stage_changed`), para poder
ser gatilho de automação — "quando virar qualificado, avise o vendedor".

---

## 7. Segurança

Endpoint público recebendo dados de fora exige mais cuidado que o resto do
sistema:

| Risco | Tratamento |
|---|---|
| Token vazado | um por origem, revogável; guardado como hash |
| Enxurrada de chamadas | limite por origem (`lib/rate-limit.ts` já existe) |
| Corpo gigante | teto de tamanho, rejeitando com 413 |
| Injeção pelo payload | tudo passa por validação e normalização; nada é gravado cru fora do registro de auditoria |
| SSRF no passo de webhook | lista de destinos permitidos + bloqueio de rede interna |
| LGPD | a origem precisa declarar o consentimento; sem isso o lead entra **sem** opt-in de marketing |

Esse último merece atenção: um lead que chega de um formulário **não** é
automaticamente alguém que aceitou receber marketing. O `defaults` da origem
deve dizer explicitamente se aquele canal capta consentimento, e o padrão
seguro é não presumir.

---

## 8. Fases sugeridas

| Fase | Entrega | Tamanho |
|---|---|---|
| **A** | Endpoint + `webhook_sources` + `webhook_deliveries` + mapeamento. Origem cadastrada por script | média |
| **B** | Campos de lead em `contacts` + as três travas contra disparo acidental | pequena |
| **C** | Tela `/leads` + tela de cadastro de origens | **a maior** |
| **D** | Passo `webhook` de saída (fecha o ciclo com o Make) | pequena |

Sugiro **A + B primeiro**: com elas já dá para ligar um cenário do Make de
verdade e ver o lead entrando e caindo numa automação. A tela vem depois,
quando o formato dos dados já estiver provado por uso real — a mesma ordem que
funcionou nas automações.

---

## 9. Decisões que preciso de você

1. **Lead é contato com estágio** (recomendado) ou tabela separada?
2. **Estágios do funil**: `novo → contatado → qualificado → convertido/perdido`
   serve, ou o time usa outros nomes?
3. **Consentimento na entrada**: lead que chega pelo Make já pode receber
   e-mail de nutrição, ou entra sem opt-in até alguém confirmar?
4. **Responsável**: leads são atribuídos a um usuário do sistema, ou ficam num
   balcão comum?
5. **Origens previstas** além do Make — para eu dimensionar o mapeamento.
