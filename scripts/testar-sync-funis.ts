// Conferência da sincronização com DOIS funis do Pipedrive, de ponta a ponta.
//
// Roda contra o banco do .env.local (o de desenvolvimento) com uma API do
// Pipedrive DE MENTIRA — sem token e sem rede. Cria dez contatos de teste,
// sincroniza três vezes, confere etapa, qualificação, marca-d'água, espelho dos
// negócios e pontuação, e apaga tudo no fim (inclusive as chaves de
// app_settings que as passadas escrevem). Precisa das migrações
// scripts/migrate-sincroniza-funil-*.ts aplicadas.
//
//   npx tsx scripts/testar-sync-funis.ts
//
// Roda sob tsx DE PROPÓSITO: é o carregador dos workers, o mesmo em que a
// biblioteca de telefone morria até 15/09/2026 — os casos G e H só passam se o
// telefone funcionar lá.
//
// Não se chama migrate-* de propósito: o deploy roda todos os migrate-*.ts.

import { config } from "dotenv";
import { and, asc, eq, gte, inArray, like } from "drizzle-orm";

import {
  appSettings,
  contactEvents,
  contacts,
  getDb,
  pipedriveDeals,
} from "../lib/db";
import { lerConfiguracao, lerRegras, recalcularContato } from "../lib/leads/score";
import type {
  DealDoPipedrive,
  PessoaDoPipedrive,
  PipedriveApi,
} from "../lib/pipedrive/client";
import { importarEnderecosDasColunasAntigas } from "../lib/contatos/enderecos";
import { sincronizarPipedrive } from "../lib/pipedrive/sync";

config({ path: ".env.local" });

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) {
    falhas++;
    console.log(
      `  X ${nome}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`
    );
  } else console.log(`  ok ${nome}`);
}

const MARCA = `teste-sync-funis-${Date.now()}`;
const email = (quem: string) => `${MARCA}-${quem}@exemplo.invalid`;

// Celulares de DDD 69 com final aleatório: o telefone é único na tabela de
// contatos, e o banco de dev tem números de verdade.
const FINAL = String(Math.floor(Math.random() * 8_000_000) + 1_000_000);
const CELULAR_G = `+556998${FINAL}`; // cadastrado COM o nono dígito
const CELULAR_H = `+55699${String(Number(FINAL) + 1).padStart(7, "0")}`;

// Ids de negócio bem acima dos reais, para o espelho de teste não encostar em
// negócio de verdade — e para a limpeza saber o que apagar.
const BASE_DOS_IDS = 900_000_000;

// Os nomes crus, como a API devolveu em 14/09/2026.
const ETAPAS_PD: Record<number, Map<number, string>> = {
  8: new Map([
    [60, "Pesquisa"],
    [61, "Realizar contato "],
    [62, "Qualificar lead"],
    [63, "Agendar apresentação parte técnica"],
    [64, "Apresentar parte técnica"],
    [65, "Apresentar proposta comercial"],
    [66, "Analisando proposta"],
    [67, "Aguardar assinatura  e pagamento"],
  ]),
  14: new Map([
    [97, "Pesquisa"],
    [98, "Realizar Contato"],
    [99, "Qualificar lead"],
    [100, "Em análise/Agendar apresentação "],
    [101, "Apresentar parte técnica"],
    [102, "Apresentar proposta comercial"],
    [103, "Analisando proposta"],
    [104, "Aguardar assinatura  e pagamento"],
  ]),
};

function deal(
  id: number,
  personId: number,
  stageId: number,
  updateTime: string,
  status = "open",
  qualificacaoCrua: unknown = null
): DealDoPipedrive {
  return {
    id: BASE_DOS_IDS + id,
    personId,
    stageId,
    updateTime,
    status,
    qualificacaoCrua,
  };
}

const DEALS: Record<number, DealDoPipedrive[]> = {
  8: [
    deal(1, 1, 66, "2026-09-10T10:00:00Z", "open", 78),
    deal(2, 3, 65, "2026-09-10T11:00:00Z"),
    deal(3, 4, 67, "2026-09-10T12:00:00Z", "won"),
    deal(5, 5, 62, "2026-09-10T12:30:00Z"),
    // Casa pelo telefone: e-mail diferente no Pipedrive, e o celular do lead é
    // o SEGUNDO número da pessoa.
    deal(10, 7, 62, "2026-09-10T14:10:00Z"),
    // J tem um aberto aqui e um perdido no outro funil — até o aberto sumir.
    deal(12, 10, 62, "2026-09-10T14:30:00Z"),
  ],
  14: [
    deal(4, 2, 100, "2026-09-10T09:00:00Z"),
    // C tem outro aberto, mais recente e MENOS adiantado: vale a proposta.
    deal(6, 3, 98, "2026-09-10T13:00:00Z"),
    deal(7, 99, 99, "2026-09-10T13:30:00Z", "lost"),
    // F chega à análise e perde OUTRO negócio depois: o aberto segura a etapa.
    deal(9, 6, 103, "2026-09-10T13:45:00Z"),
    deal(8, 6, 103, "2026-09-10T14:00:00Z", "lost"),
    // Casa pelo telefone: no Pipedrive o número vem com o nono dígito, e o
    // contato foi cadastrado sem ele.
    deal(11, 8, 97, "2026-09-10T14:20:00Z"),
    // I só tem negócio perdido: vai para Perdido.
    deal(13, 9, 99, "2026-09-10T14:40:00Z", "lost"),
    deal(14, 10, 98, "2026-09-10T14:50:00Z", "lost"),
  ],
};

const PESSOAS = new Map<number, PessoaDoPipedrive>([
  [1, { emails: [email("a")], phones: [] }],
  [2, { emails: [email("b")], phones: [] }],
  [3, { emails: [email("c").toUpperCase()], phones: [] }],
  [4, { emails: [email("d")], phones: [] }],
  [5, { emails: [email("e")], phones: [] }],
  [6, { emails: [email("f")], phones: [] }],
  [
    7,
    {
      emails: [email("g-outro")],
      phones: ["31 3241-0000", `(69) ${CELULAR_G.slice(5, 10)}-${CELULAR_G.slice(10)}`],
    },
  ],
  [
    8,
    {
      emails: [],
      phones: [`+55 69 9${CELULAR_H.slice(5, 9)}-${CELULAR_H.slice(9)}`],
    },
  ],
  [9, { emails: [email("i")], phones: [] }],
  [10, { emails: [email("j")], phones: [] }],
  [99, { emails: [email("desconhecido")], phones: [] }],
]);

const pedidosDesde: Record<number, (string | undefined)[]> = { 8: [], 14: [] };
/** Negócios que a API de mentira deixa de listar (excluídos ou movidos). */
const ocultos = new Set<number>();

const apiDeMentira: PipedriveApi = {
  async pipelines() {
    return [
      { id: 8, name: "White Label - Inbound" },
      { id: 10, name: "Funil que ninguém acompanha" },
      { id: 14, name: "SDR-TESTE-NRG" },
    ];
  },
  async stages(pipelineId) {
    return ETAPAS_PD[pipelineId] ?? new Map();
  },
  async campoDeDeal() {
    return {
      key: "campo-qualificacao",
      opcoes: new Map([
        [76, "Sim: Intermediário"],
        [78, "Sim: Experiente"],
      ]),
    };
  },
  async deals({ pipelineId, updatedSince }) {
    pedidosDesde[pipelineId]?.push(updatedSince);
    const todos = (DEALS[pipelineId] ?? []).filter((d) => !ocultos.has(d.id));
    return {
      deals: updatedSince
        ? todos.filter((d) => d.updateTime >= updatedSince)
        : todos,
      nextCursor: null,
    };
  },
  async pessoas(ids) {
    return new Map(
      ids.filter((id) => PESSOAS.has(id)).map((id) => [id, PESSOAS.get(id)!])
    );
  },
};

const CHAVES_DA_PASSADA = [
  "pipedrive_funis",
  "pipedrive_sync_funis",
  "pipedrive_sync_ultima",
  "pipedrive_sync_desde:8",
  "pipedrive_sync_desde:14",
  "pipedrive_releitura_ultima",
  "pipedrive_releitura_inicio:8",
  "pipedrive_releitura_inicio:14",
];

async function main() {
  const db = getDb();

  // O que as passadas vão sobrescrever, para devolver no fim.
  const antes = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, CHAVES_DA_PASSADA));

  try {
    await db
      .delete(appSettings)
      .where(inArray(appSettings.key, CHAVES_DA_PASSADA));
    await db.insert(appSettings).values({ key: "pipedrive_funis", value: "[8,14]" });

    const criados = await db
      .insert(contacts)
      .values([
        { name: "Teste A", email: email("a"), stage: "qualificado" },
        { name: "Teste B", email: email("b"), stage: "apresentacao-de-produto" },
        { name: "Teste C", email: email("c"), stage: "qualificado" },
        { name: "Teste D", email: email("d"), stage: "realizar-contato" },
        // Parceiro: aparece no Pipedrive, mas não entra no funil daqui.
        { name: "Teste E", email: email("e"), stage: null },
        { name: "Teste F", email: email("f"), stage: "qualificado" },
        { name: "Teste G", email: email("g"), phone: CELULAR_G, stage: "qualificado" },
        { name: "Teste H", email: email("h"), phone: CELULAR_H, stage: "qualificado" },
        { name: "Teste I", email: email("i"), stage: "qualificado" },
        { name: "Teste J", email: email("j"), stage: "qualificado" },
      ])
      .returning({ id: contacts.id, email: contacts.email });
    // A sincronização casa pelos endereços (contact_emails/contact_phones).
    await importarEnderecosDasColunasAntigas(db);
    const id = (quem: string) => criados.find((c) => c.email === email(quem))!.id;

    const estado = async (quem: string) => {
      const [c] = await db
        .select({ stage: contacts.stage, qualification: contacts.qualification })
        .from(contacts)
        .where(eq(contacts.id, id(quem)));
      return c;
    };
    const passagensDe = async (quem: string) =>
      (
        await db
          .select({ payload: contactEvents.payload })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.contactId, id(quem)),
              eq(contactEvents.type, "lead_stage_changed")
            )
          )
          .orderBy(asc(contactEvents.createdAt))
      ).map((p) => (p.payload as { para: string }).para);

    console.log("— primeira passada (os dois funis do zero):");
    const r1 = await sincronizarPipedrive({ api: apiDeMentira, intervaloMin: 0 });
    ok("rodou", r1.rodou, true);
    ok("dois funis", r1.funis, 2);
    ok("catorze deals lidos", r1.deals, 14);
    ok("um deal sem contato", r1.semContato, 1);
    ok("nenhuma recusa", r1.recusas, 0);
    ok("leram do zero", [pedidosDesde[8][0], pedidosDesde[14][0]], [
      undefined,
      undefined,
    ]);

    ok("A: etapa do White Label", (await estado("a")).stage, "analisando-proposta");
    ok("A: qualificado pelo campo", (await estado("a")).qualification, "experiente");
    ok(
      "B: nome do SDR-TESTE-NRG cai no apelido",
      (await estado("b")).stage,
      "agendar-apresentacao-parte-tecnica"
    );
    ok(
      "C: entre dois abertos, vale o mais adiantado",
      (await estado("c")).stage,
      "apresentar-proposta-comercial"
    );
    ok("D: ganho vira compra", (await estado("d")).stage, "comprou");
    ok("E: parceiro continua parceiro", (await estado("e")).stage, null);
    ok(
      "F: o aberto segura a etapa, mesmo com um perdido mais novo",
      (await estado("f")).stage,
      "analisando-proposta"
    );
    ok(
      "G: casou pelo segundo telefone da pessoa",
      (await estado("g")).stage,
      "qualificar-lead"
    );
    ok(
      "H: casou com o cadastro sem o nono dígito",
      (await estado("h")).stage,
      "pesquisa"
    );
    ok("I: só perdidos vai para Perdido", (await estado("i")).stage, "perdido");
    ok("J: aberto + perdido fica no aberto", (await estado("j")).stage, "qualificar-lead");

    ok(
      "C e F: uma mudança só, sem ida e volta",
      [await passagensDe("c"), await passagensDe("f")],
      [["apresentar-proposta-comercial"], ["analisando-proposta"]]
    );

    const espelho = await db
      .select({ id: pipedriveDeals.id, contactId: pipedriveDeals.contactId })
      .from(pipedriveDeals)
      .where(gte(pipedriveDeals.id, BASE_DOS_IDS));
    ok("espelho guardou os catorze negócios", espelho.length, 14);
    ok(
      "no espelho, o negócio casado por telefone aponta para G",
      espelho.find((n) => n.id === BASE_DOS_IDS + 10)?.contactId,
      id("g")
    );

    const marcas = await db
      .select()
      .from(appSettings)
      .where(like(appSettings.key, "pipedrive_sync_desde:%"));
    ok(
      "uma marca-d'água por funil",
      marcas.map((m) => `${m.key}=${m.value}`).sort(),
      [
        "pipedrive_sync_desde:14=2026-09-10T14:50:00Z",
        "pipedrive_sync_desde:8=2026-09-10T14:30:00Z",
      ]
    );
    const [vistos] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "pipedrive_sync_funis"));
    ok("a tela sabe o nome dos funis", JSON.parse(vistos.value ?? "{}"), {
      funis: [
        { id: 8, nome: "White Label - Inbound" },
        { id: 14, nome: "SDR-TESTE-NRG" },
      ],
      ausentes: [],
    });

    console.log("— segunda passada (só o que mudou desde a marca):");
    const r2 = await sincronizarPipedrive({ api: apiDeMentira, intervaloMin: 0 });
    ok("partiu da marca de cada funil", [pedidosDesde[8][1], pedidosDesde[14][1]], [
      "2026-09-10T14:30:00Z",
      "2026-09-10T14:50:00Z",
    ]);
    ok("releitura parcial não muda ninguém", r2.etapasAplicadas, 0);

    console.log("— terceira passada (releitura completa; o aberto de J sumiu):");
    ocultos.add(BASE_DOS_IDS + 12);
    await db
      .delete(appSettings)
      .where(
        inArray(appSettings.key, [
          "pipedrive_sync_desde:8",
          "pipedrive_sync_desde:14",
        ])
      );
    const r3 = await sincronizarPipedrive({ api: apiDeMentira, intervaloMin: 0 });
    ok("releu do zero", [pedidosDesde[8][2], pedidosDesde[14][2]], [
      undefined,
      undefined,
    ]);
    ok("só J muda — quem estava certo não ganha evento de novo", r3.etapasAplicadas, 1);
    ok("J: o aberto saiu do funil, sobrou o perdido", (await estado("j")).stage, "perdido");
    const [sumiu] = await db
      .select({ status: pipedriveDeals.status })
      .from(pipedriveDeals)
      .where(eq(pipedriveDeals.id, BASE_DOS_IDS + 12));
    ok("no espelho, o negócio que sumiu fica marcado como fora", sumiu?.status, "fora");
    ok(
      "C: a releitura não repetiu a mudança",
      await passagensDe("c"),
      ["apresentar-proposta-comercial"]
    );

    console.log("— pontuação (vale a etapa atual):");
    const [regras, configuracao] = await Promise.all([lerRegras(), lerConfiguracao()]);
    const pontosDe = (para: string) =>
      regras.find(
        (r) =>
          r.eventType === "lead_stage_changed" &&
          (r.condition as { para?: string } | null)?.para === para
      )?.points ?? 0;
    const experiente =
      regras.find(
        (r) =>
          r.eventType === "lead_qualified" &&
          (r.condition as { qualificacao?: string } | null)?.qualificacao ===
            "experiente"
      )?.points ?? 0;
    const a = await recalcularContato(id("a"), regras, configuracao);
    ok("A: etapa + qualificação", a.score, pontosDe("analisando-proposta") + experiente);
    const c = await recalcularContato(id("c"), regras, configuracao);
    ok("C: pontos da proposta", c.score, pontosDe("apresentar-proposta-comercial"));
    const f = await recalcularContato(id("f"), regras, configuracao);
    ok("F: pontos da análise, apesar do perdido", f.score, pontosDe("analisando-proposta"));
    const i = await recalcularContato(id("i"), regras, configuracao);
    ok("I: perdido não pontua", i.score, pontosDe("perdido"));
  } finally {
    await db.delete(contacts).where(like(contacts.email, `${MARCA}-%`));
    await db.delete(pipedriveDeals).where(gte(pipedriveDeals.id, BASE_DOS_IDS));
    await db.delete(appSettings).where(inArray(appSettings.key, CHAVES_DA_PASSADA));
    if (antes.length > 0) await db.insert(appSettings).values(antes);
  }

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
