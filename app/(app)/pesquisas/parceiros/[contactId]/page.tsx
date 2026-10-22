"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, UserRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { FormularioPesquisa } from "@/components/pesquisas/formulario-pesquisa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SURVEY_OBJECTIVES, type SurveyInviteStatus } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";
import type { ParceiroDto } from "@/lib/pesquisas/relatorio-db";
import {
  CONVITE_STATUS_LABEL,
  OBJETIVO_DESCRICAO,
  OBJETIVO_LABEL,
} from "@/lib/pesquisas/rotulos";

const CONVITE_VARIANT: Record<SurveyInviteStatus, "secondary" | "info" | "warning" | "success" | "outline"> = {
  pending: "secondary",
  opened: "info",
  in_progress: "warning",
  completed: "success",
  closed: "outline",
};

export default function ParceiroPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const [dados, setDados] = useState<ParceiroDto | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      setErro("");
      const res = await fetch(`/api/pesquisas/parceiros/${contactId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar o parceiro.");
      setDados(json);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    }
  }, [contactId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href="/pesquisas/parceiros">
            <ArrowLeft />
            Voltar para o painel
          </Link>
        </Button>
        <PageHeader
          title={dados?.contact.name ?? "Parceiro"}
          description={dados ? (dados.contact.company ?? "sem empresa informada") : undefined}
        >
          {dados ? (
            <Button variant="outline" asChild>
              <Link href={`/contacts/${dados.contact.id}`}>
                <UserRound />
                Ficha do contato
              </Link>
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {erro ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {erro}
        </div>
      ) : null}

      {!dados ? (
        <Card>
          <p className="py-12 text-center text-sm text-muted-foreground">
            {erro ? "Sem dados." : "Carregando..."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-6">
          {SURVEY_OBJECTIVES.map((o) => {
            const f = dados.frentes[o];
            return (
              <Card key={o} className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{OBJETIVO_LABEL[o]}</h2>
                    <p className="text-xs text-muted-foreground">{OBJETIVO_DESCRICAO[o]}</p>
                  </div>
                  {f ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={CONVITE_VARIANT[f.status]}>{CONVITE_STATUS_LABEL[f.status]}</Badge>
                      {f.nps !== null ? <Badge variant="info">NPS {f.nps}</Badge> : null}
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/pesquisas/${f.surveyId}`}>
                          <ExternalLink />
                          {f.surveyName}
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </div>
                {!f ? (
                  <p className="text-sm text-muted-foreground">Ainda não foi convidado nesta frente.</p>
                ) : (
                  <>
                    <p className="mb-4 text-xs text-muted-foreground">
                      Convidado em {formatDate(f.createdAt)}
                      {f.completedAt ? ` · concluiu em ${formatDate(f.completedAt)}` : ` · ${f.respondidas} de ${f.total} respondidas`}
                    </p>
                    {f.respondidas === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma resposta ainda.</p>
                    ) : (
                      <FormularioPesquisa perguntas={f.perguntas} respostas={f.respostas} somenteLeitura />
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
