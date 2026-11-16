import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  ImprimirEmailButton,
  ReenviarEmailButton,
} from "@/components/reports/email-acoes";
import { EmailQuadro } from "@/components/reports/email-quadro";
import { Reenvios } from "@/components/reports/reenvios";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CampaignKind } from "@/lib/db";
import {
  campanhaPorId,
  mjmlDaCampanha,
  NOME_GENERICO,
  podeReenviar,
  registroDoEnvio,
} from "@/lib/reenvio";

const numero = new Intl.NumberFormat("pt-BR");

/**
 * O e-mail de uma campanha (ou edição do Avante News) como os destinatários o
 * receberam: para conferir depois do disparo, imprimir ou salvar em PDF e
 * reenviar para endereços específicos.
 */
export async function EmailEnviado({
  id,
  kind,
  reportHref,
}: {
  id: string;
  /** A rota de campanhas não abre edição do News, e vice-versa. */
  kind: CampaignKind;
  reportHref: string;
}) {
  const campanha = await campanhaPorId(id);
  if (!campanha || campanha.kind !== kind || campanha.channel !== "email") {
    notFound();
  }

  const [registro, mjml] = await Promise.all([
    registroDoEnvio(campanha),
    mjmlDaCampanha(campanha),
  ]);
  const temEmail = Boolean(mjml);

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href={reportHref}>
            <ArrowLeft />
            Voltar para o relatório
          </Link>
        </Button>
        <PageHeader
          title={campanha.name}
          description={
            registro.enviadaEm
              ? `E-mail enviado em ${registro.enviadaEm}${registro.autor ? ` por ${registro.autor}` : ""}`
              : "E-mail da campanha — ainda não enviada"
          }
        >
          <CampaignStatusBadge status={campanha.status} />
          {temEmail ? <ImprimirEmailButton campaignId={campanha.id} /> : null}
          {temEmail && podeReenviar(campanha) ? (
            <ReenviarEmailButton
              campaignId={campanha.id}
              assunto={campanha.subject}
              variant="default"
            />
          ) : null}
        </PageHeader>
      </div>

      <Card className="overflow-hidden">
        <dl className="grid gap-x-4 gap-y-1.5 border-b border-border bg-muted/60 px-5 py-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-xs text-muted-foreground sm:pt-0.5">Assunto</dt>
          <dd className="font-medium">{campanha.subject || "(sem assunto)"}</dd>
          {campanha.preheader?.trim() ? (
            <>
              <dt className="text-xs text-muted-foreground sm:pt-0.5">
                Pré-cabeçalho
              </dt>
              <dd>{campanha.preheader}</dd>
            </>
          ) : null}
          {process.env.SES_FROM_EMAIL ? (
            <>
              <dt className="text-xs text-muted-foreground sm:pt-0.5">De</dt>
              <dd>{process.env.SES_FROM_EMAIL}</dd>
            </>
          ) : null}
          <dt className="text-xs text-muted-foreground sm:pt-0.5">Para</dt>
          <dd>
            {registro.destinatarios > 0
              ? `${numero.format(registro.destinatarios)} destinatário${registro.destinatarios === 1 ? "" : "s"} · `
              : ""}
            {registro.listas}
          </dd>
        </dl>
        {temEmail ? (
          <EmailQuadro
            src={`/api/campaigns/${campanha.id}/email`}
            title={`E-mail da campanha ${campanha.name}`}
          />
        ) : (
          <p className="px-5 py-16 text-center text-sm text-muted-foreground">
            Esta campanha não tem e-mail montado.
          </p>
        )}
      </Card>

      {temEmail ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Onde o e-mail traz {NOME_GENERICO}, cada destinatário recebeu o
          próprio nome. Abrir esta tela não conta como abertura nem clique.
        </p>
      ) : null}

      <Reenvios campaignId={campanha.id} />
    </>
  );
}
