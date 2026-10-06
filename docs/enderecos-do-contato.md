# Endereços do contato — vários telefones e vários e-mails

Desde 06/10/2026 um contato tem **vários telefones e vários e-mails**, cada um
com o próprio consentimento, e a campanha vai para **todos** os que aceitam o
canal. Decisões tomadas com o Fernando nessa data:

| Pergunta | Decisão |
| --- | --- |
| Campanha vai para todos os endereços ou só para o principal? | **Todos.** Quem tem dois telefones recebe nos dois; cada mensagem conta no relatório, no custo e no limite diário. |
| No CSV só com nome e telefone, como achar o contato? | E-mail cadastrado → telefone cadastrado → **nome igual a um contato só**. Nome repetido fica pendente; ninguém → contato novo. |
| SAIR num número / descadastro num e-mail: o que sai? | **Só aquele número ou e-mail.** Os outros continuam. |

## Modelo (lib/db/schema.ts)

- `contact_phones`: `phone` (E.164, único), `whatsapp_subscribed/opt_in_at/opt_out_at`,
  `sms_subscribed/opt_in_at/opt_out_at`, `principal`.
- `contact_emails`: `email` (minúsculo, único), `subscribed`, `opt_out_at`, `principal`.
- `contacts.email` passou a aceitar nulo (contato só com telefone).
- As colunas `email`, `phone`, `subscribed`, `whatsapp_*` e `sms_*` de `contacts`
  são um **resumo**: principal + "algum endereço aceita". Quem escreve nelas é
  só `lib/contatos/enderecos.ts` (`sincronizarResumo`). Telas, filtros e
  condições de automação continuam lendo o resumo.
- `campaign_sends.address`: para onde cada envio foi. Índice único por
  (campanha, contato, endereço). Envios de antes têm `address` nulo e valem
  pelo endereço/consentimento do contato.

## Quem faz o quê

- `lib/contatos/enderecos.ts` — leitura e escrita dos endereços; opt-out por
  endereço (`optOutEmail`, `optOutTelefone`, `optOutTelefonePorWaId`); casamento
  em lote (`contatosPorEnderecos`).
- `lib/contatos/destinatarios.ts` — expansão da campanha em endereços
  (`enderecosElegiveis`), contagem em mensagens, endereço único do passo de
  automação (principal que aceita, senão o primeiro), consentimento na hora do
  envio (`enderecoAceita`).
- `lib/contatos/casamento.ts` — a regra pura de casar a linha do CSV com a
  base (testada sem banco).
- `lib/contatos/corpo.ts` — os endereços no corpo da API de contatos, nos dois
  formatos (listas; ou um de cada, como era antes — na edição troca só o
  principal).

## Importação (app/api/contacts/import)

Importa **e atualiza**: só o nome é obrigatório, com e-mail ou telefone. Uma
célula pode trazer vários números ou e-mails. Quem casa ganha os endereços que
faltavam (empresa só completa lacuna, tags somam, lista entra); quem não casa é
criado. Lead casa por e-mail/telefone (para não duplicar), nunca pelo nome.
Pendências (nome repetido, e-mail de um com telefone de outro, linha sem dado
válido) voltam numa tabela com download; nada delas é gravado.

## O que fica por endereço e o que fica por contato

- Por endereço: consentimento, SAIR/STOP, link de descadastro (o token leva o
  e-mail), devolução definitiva e reclamação de spam, erro 21614/21610 da Twilio.
- Por contato: os eventos `email_unsubscribed`, `whatsapp_unsubscribed` e
  `sms_unsubscribed` — disparam quando **não sobra** endereço aceitando o canal
  (é o que a supressão das automações lê).
- Passo de automação manda **uma** mensagem por contato (endereço principal que
  aceita).

## Migração

`scripts/migrate-contatos-enderecos.ts` (idempotente, roda no deploy): cria as
tabelas, copia o e-mail e o telefone de cada contato como principal, libera o
nulo em `contacts.email`, cria `campaign_sends.address` e troca o índice único.
Scripts que inserem em `contacts` direto (seed, testes) chamam
`importarEnderecosDasColunasAntigas` depois.

## Filtro de destinatários por planilha (assistente de campanha)

`components/campaigns/planilha-filter-dialog.tsx` + `lib/contatos/filtro-planilha.ts`
(06/10/2026). Vale para e-mail, WhatsApp e SMS. A planilha colada ou enviada
(.csv) pode trazer o que tiver; a linha seleciona o contato se casar por:
e-mail igual (qualquer célula com @), telefone de trás para frente (6 dígitos
finais; com cabeçalho reconhecido, só as colunas de telefone — CNPJ e CEP não
entram), ou nome igual (só com coluna de nome no cabeçalho: nome/name/contato/
cliente/razão social). Nome repetido na base seleciona todos e avisa. Só
seleciona entre os contatos já elegíveis da campanha; nada é criado.

