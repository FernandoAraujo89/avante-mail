"use client";

import { AlertTriangle, Info } from "lucide-react";

import { SmsPhonePreview } from "@/components/sms/phone-preview";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatBrl, formatInt } from "@/lib/format";
import { countSms, estimateSmsCostUsd, sanitizeGsm7 } from "@/lib/sms/gsm7";
import { cn } from "@/lib/utils";

// Passo "Mensagem" do wizard para campanhas de SMS.
//
// O trabalho real deste componente não é editar texto — é mostrar a CONTA
// antes de ela existir. Em SMS, três coisas invisíveis custam dinheiro:
// passar de 160 caracteres (dobra), um emoji (triplica) e o número de
// destinatários (multiplica tudo). Todas as três ficam visíveis aqui,
// enquanto a pessoa digita e ainda dá para mudar de ideia.

export function SmsMessageStep({
  value,
  onChange,
  recipientCount,
  pricePerSegmentUsd,
  usdBrlRate,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Destinatários estimados; null enquanto a contagem não chegou. */
  recipientCount: number | null;
  pricePerSegmentUsd: number | null;
  usdBrlRate: number | null;
}) {
  const sanitizado = sanitizeGsm7(value);
  // A contagem que vale é a do texto TRANSLITERADO — é ele que sai.
  const contagem = countSms(sanitizado.texto);
  // A do texto cru só serve para dizer quanto o emoji custaria.
  const contagemCrua = countSms(value);

  const temEmoji = sanitizado.emojis.length > 0;
  const temInvalido = sanitizado.foraDoGsm7.length > 0;
  const foiTransliterado = value.length > 0 && sanitizado.texto !== value;

  const custoBrl =
    pricePerSegmentUsd !== null && usdBrlRate !== null && recipientCount !== null
      ? estimateSmsCostUsd(
          contagem.segmentos,
          recipientCount,
          pricePerSegmentUsd
        ) * usdBrlRate
      : null;

  return (
    // @container: o passo aparece na largura do wizard e pode ser reaproveitado
    // em painel estreito. As colunas respondem ao espaço REAL do componente.
    <div className="@container grid items-start gap-6 @4xl:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="grid gap-5 p-4 @md:p-6">
          <div className="grid gap-2">
            <Label htmlFor="sms-body">Texto da mensagem *</Label>
            <Textarea
              id="sms-body"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={6}
              placeholder="Ex.: Avante: seu boleto vence amanha. Acesse avante.tools/2via para a segunda via."
              className="min-h-36 resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Inclua o nome da empresa e uma forma de sair — a operadora exige
              identificação, e quem não reconhece o remetente denuncia.
            </p>
          </div>

          {/* Contagem: a linha que evita a surpresa na fatura. */}
          <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3 @sm:p-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span>
                <strong className="tabular-nums">
                  {formatInt(contagem.caracteres)}
                </strong>{" "}
                <span className="text-muted-foreground">caracteres</span>
              </span>
              <span
                className={cn(
                  contagem.segmentos > 1 ? "text-amber-600 dark:text-amber-500" : ""
                )}
              >
                <strong className="tabular-nums">{contagem.segmentos}</strong>{" "}
                <span
                  className={cn(
                    contagem.segmentos > 1 ? "" : "text-muted-foreground"
                  )}
                >
                  {contagem.segmentos === 1 ? "segmento" : "segmentos"}
                </span>
              </span>
              <span className="text-muted-foreground">
                <strong className="tabular-nums">
                  {formatInt(contagem.restante)}
                </strong>{" "}
                até o próximo
              </span>
            </div>

            {contagem.segmentos > 1 ? (
              <p className="flex gap-2 text-xs text-amber-700 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Acima de 160 caracteres a mensagem é cobrada como{" "}
                  {contagem.segmentos} SMS por destinatário. Quem recebe continua
                  vendo uma mensagem só — a diferença aparece na fatura.
                </span>
              </p>
            ) : null}

            {custoBrl !== null ? (
              <p className="text-sm">
                <span className="text-muted-foreground">
                  Custo estimado para {formatInt(recipientCount ?? 0)}{" "}
                  {recipientCount === 1 ? "destinatário" : "destinatários"}:
                </span>{" "}
                <strong className="tabular-nums">{formatBrl(custoBrl)}</strong>
              </p>
            ) : null}
          </div>

          {temEmoji ? (
            <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Remova {sanitizado.emojis.join(" ")}</strong> — emoji não
                existe no alfabeto do SMS. Com ele, cada segmento cai de 160 para
                70 caracteres e esta mensagem passaria de {contagem.segmentos}{" "}
                para {contagemCrua.segmentos}{" "}
                {contagemCrua.segmentos === 1 ? "segmento" : "segmentos"} por
                pessoa. O disparo fica bloqueado até o emoji sair.
              </span>
            </p>
          ) : null}

          {temInvalido ? (
            <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                O SMS não aceita {sanitizado.foraDoGsm7.join(" ")}. Troque por um
                equivalente simples antes de disparar.
              </span>
            </p>
          ) : null}

          {foiTransliterado && !temEmoji && !temInvalido ? (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Acentos e aspas especiais saem sem acento no envio — parte das
                operadoras entrega acento como lixo no aparelho. A prévia ao lado
                mostra o texto exatamente como ele chega.
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="@4xl:sticky @4xl:top-6">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Prévia (como chega no aparelho)
        </p>
        <SmsPhonePreview bodyText={sanitizado.texto} senderLabel="Avante" />
      </div>
    </div>
  );
}
