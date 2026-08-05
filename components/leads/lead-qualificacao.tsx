import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { qualificacaoInfo } from "@/components/leads/qualificacoes";
import { formatDate } from "@/lib/format";

/**
 * Quem o lead é e onde ele está — as duas coisas que chegam do agente.
 *
 * O texto do playbook fica aqui inteiro, e não só o rótulo: quem escreve a
 * nutrição precisa saber o que "Alto Potencial" quer dizer no momento em que
 * está decidindo o que mandar. Sem isso, a etiqueta é só uma palavra bonita.
 */
export function LeadQualificacao({
  qualificacao,
  qualificadoEm,
  etapa,
  etapaDesde,
  encerraNutricao,
}: {
  qualificacao: string | null;
  qualificadoEm: Date | null;
  etapa: string | null;
  etapaDesde: Date | null;
  encerraNutricao: boolean;
}) {
  const info = qualificacaoInfo(qualificacao);

  const blocos = info
    ? [
        { rotulo: "Quem são", texto: info.quemSao },
        { rotulo: "Perfil", texto: info.perfil },
        { rotulo: "Motivações", texto: info.motivacoes },
        { rotulo: "Dores", texto: info.dores },
      ].filter((b) => b.texto)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Qualificação e funil</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">
            Qualificação do agente
          </p>
          {info ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={info.variante}>{info.rotulo}</Badge>
                <span className="text-xs text-muted-foreground">
                  potencial {info.potencial.toLowerCase()}
                  {qualificadoEm ? ` · em ${formatDate(qualificadoEm)}` : ""}
                </span>
              </div>
              <dl className="mt-1 grid gap-2 text-xs">
                {blocos.map((b) => (
                  <div key={b.rotulo}>
                    <dt className="font-medium">{b.rotulo}</dt>
                    <dd className="text-muted-foreground">{b.texto}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem qualificação. O agente a envia junto com o lead — se está
              faltando, confira o mapeamento da origem.
            </p>
          )}
        </div>

        <div className="grid gap-1.5 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Etapa no funil</p>
          <p className="text-sm font-medium">{etapa ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {etapaDesde ? `Desde ${formatDate(etapaDesde)}. ` : ""}
            Espelha o Pipedrive e é atualizada pelo agente — não se altera por
            aqui.
          </p>
          {encerraNutricao ? (
            <p className="rounded-lg border border-warning-dark/30 bg-warning-light/30 px-3 py-2 text-xs text-warning-dark">
              Esta etapa encerra a nutrição: os fluxos em andamento deste lead
              foram parados quando ele chegou aqui.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
