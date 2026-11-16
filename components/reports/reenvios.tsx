import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { reenviosDaCampanha } from "@/lib/reenvio";

/**
 * Histórico dos reenvios avulsos do e-mail de uma campanha: quem reenviou,
 * para quem e quando. Não aparece enquanto ninguém reenviou nada.
 */
export async function Reenvios({ campaignId }: { campaignId: string }) {
  const reenvios = await reenviosDaCampanha(campaignId);
  if (reenvios.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-4">
        <CardTitle>Reenvios avulsos</CardTitle>
        <CardDescription>
          O e-mail desta campanha reenviado à mão para endereços específicos.
          Não entram nas métricas acima.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Para</TableHead>
            <TableHead>Reenviado por</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reenvios.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(r.createdAt)}
              </TableCell>
              <TableCell>
                <div className="font-medium">
                  {r.contactId ? (
                    <Link
                      href={`/contacts/${r.contactId}`}
                      className="hover:underline"
                    >
                      {r.name ?? r.email}
                    </Link>
                  ) : (
                    (r.name ?? r.email)
                  )}
                </div>
                {r.name ? (
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                ) : null}
              </TableCell>
              <TableCell>{r.sentByName ?? "não registrado"}</TableCell>
              <TableCell>
                {r.status === "sent" ? (
                  <Badge variant="success">Enviado</Badge>
                ) : (
                  <div className="grid gap-1">
                    <span>
                      <Badge variant="destructive">Falhou</Badge>
                    </span>
                    {r.errorMessage ? (
                      <span className="text-xs text-muted-foreground">
                        {r.errorMessage}
                      </span>
                    ) : null}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
