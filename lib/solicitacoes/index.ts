// Solicitações de campanha: o Sucesso do cliente pede, o marketing (admin)
// cria e dispara. Aqui ficam a leitura com nomes (de quem pediu, das listas)
// e o aviso por e-mail aos administradores.
import { desc, eq, inArray } from "drizzle-orm";

import { campaignRequests, getDb, lists, users } from "@/lib/db";
import { getBaseUrl } from "@/lib/base-url";
import { sendEmail } from "@/lib/ses";
import { errorMessage } from "@/lib/utils";

import { CANAL_LABEL, type SolicitacaoDto } from "./rotulos";

export * from "./rotulos";

/** Solicitações com os nomes resolvidos; `id` filtra uma só. */
export async function carregarSolicitacoes(
  id?: string
): Promise<SolicitacaoDto[]> {
  const db = getDb();
  const linhas = await db
    .select()
    .from(campaignRequests)
    .where(id ? eq(campaignRequests.id, id) : undefined)
    .orderBy(desc(campaignRequests.createdAt));
  if (linhas.length === 0) return [];

  const idsListas = [...new Set(linhas.flatMap((l) => l.listIds))];
  const idsUsuarios = [
    ...new Set(
      linhas
        .flatMap((l) => [l.requestedBy, l.handledBy])
        .filter((v): v is string => !!v)
    ),
  ];
  const [nomesListas, nomesUsuarios] = await Promise.all([
    idsListas.length
      ? db
          .select({ id: lists.id, name: lists.name })
          .from(lists)
          .where(inArray(lists.id, idsListas))
      : [],
    idsUsuarios.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, idsUsuarios))
      : [],
  ]);
  const lista = new Map(nomesListas.map((l) => [l.id, l.name]));
  const usuario = new Map(nomesUsuarios.map((u) => [u.id, u.name]));
  const pessoa = (uid: string | null) =>
    uid ? { id: uid, name: usuario.get(uid) ?? "Usuário removido" } : null;

  return linhas.map((l) => ({
    id: l.id,
    title: l.title,
    channels: l.channels,
    // Lista apagada depois do pedido: o id fica, o nome vira nulo.
    lists: l.listIds.map((lid) => ({ id: lid, name: lista.get(lid) ?? null })),
    briefing: l.briefing,
    desiredAt: l.desiredAt?.toISOString() ?? null,
    status: l.status,
    responseNote: l.responseNote,
    requestedBy: pessoa(l.requestedBy),
    handledBy: pessoa(l.handledBy),
    campaignId: l.campaignId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  }));
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Avisa os administradores de que chegou pedido. Melhor esforço: falha de
 * envio fica no log e não desfaz a solicitação — ela já aparece na tela.
 */
export async function avisarAdmins(s: SolicitacaoDto): Promise<void> {
  try {
    const db = getDb();
    const admins = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, "admin"));
    if (admins.length === 0) return;

    const url = `${getBaseUrl()}/solicitacoes`;
    const canais = s.channels.map((c) => CANAL_LABEL[c]).join(" e ");
    const nomesListas = s.lists
      .map((l) => l.name ?? "(lista removida)")
      .join(", ");
    const data = s.desiredAt
      ? new Date(s.desiredAt).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })
      : "sem data definida";

    await sendEmail({
      to: admins.map((a) => a.email).join(", "),
      subject: `Nova solicitação de campanha: ${s.title}`,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#282E3F;">
          <h2 style="color:#1D50DC;">Nova solicitação de campanha</h2>
          <p><strong>${escapar(s.requestedBy?.name ?? "Alguém")}</strong> pediu uma campanha no <strong>Campanhas Avante</strong>.</p>
          <table style="font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 12px 4px 0;color:#8A98A5;">Título</td><td>${escapar(s.title)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8A98A5;">Canal</td><td>${canais}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8A98A5;">Listas</td><td>${escapar(nomesListas)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8A98A5;">Quando</td><td>${data}</td></tr>
          </table>
          <p style="white-space:pre-wrap;background:#F4F6FA;padding:12px;border-radius:8px;">${escapar(s.briefing)}</p>
          <p style="text-align:center;margin:32px 0;">
            <a href="${url}" style="background:#1D50DC;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;display:inline-block;">
              Ver solicitações
            </a>
          </p>
        </div>`,
    });
  } catch (error) {
    console.error(
      "[SOLICITACOES] Falha ao avisar os admins:",
      errorMessage(error)
    );
  }
}
