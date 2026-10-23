"use client";

import { useState } from "react";

import { headerMediaOf, WhatsAppBubblePreview } from "@/components/whatsapp/bubble-preview";
import type { SurveyMessageKind } from "@/lib/db/schema";
import {
  assuntoDaMensagem,
  htmlDaMensagem,
  preencherVariaveis,
} from "@/lib/pesquisas/mensagens";
import { PARCEIRO_DE_EXEMPLO, valoresDeExemplo } from "@/lib/pesquisas/previa";
import {
  fillVariables,
  type WhatsAppButton,
  type WhatsAppHeaderType,
  type WhatsAppVariableMap,
} from "@/lib/whatsapp/types";

// O convite como o parceiro recebe, com o layout real: o e-mail é o MESMO HTML
// que o worker manda (lib/pesquisas/mensagens.ts), dentro de um iframe; o
// WhatsApp é o balão do modelo com as variáveis preenchidas pelo parceiro de
// exemplo. O link dos dois aponta para a pré-visualização da pesquisa — assim
// a Expansão percorre o caminho inteiro: convite → pesquisa.

export function PreviaDoEmail({
  assunto,
  corpo,
  nomeDaPesquisa,
  link,
  tipo = "invite",
}: {
  assunto: string;
  corpo: string;
  nomeDaPesquisa: string;
  link: string;
  tipo?: SurveyMessageKind;
}) {
  const dados = { nome: PARCEIRO_DE_EXEMPLO.name, empresa: PARCEIRO_DE_EXEMPLO.company, pesquisa: nomeDaPesquisa };
  const assuntoFinal = assuntoDaMensagem(preencherVariaveis(assunto, dados), tipo);
  const html = htmlDaMensagem({ corpo: preencherVariaveis(corpo, dados), link, tipo, nomeDaPesquisa });
  // <base target="_blank">: o botão do e-mail abre fora do iframe, como num cliente de e-mail.
  const documento = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;background:#fff}</style></head><body>${html}</body></html>`;
  const [altura, setAltura] = useState(440);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <dl className="grid gap-x-3 gap-y-1 border-b border-border bg-muted/60 px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-xs text-muted-foreground sm:pt-0.5">Para</dt>
        <dd className="truncate">
          {PARCEIRO_DE_EXEMPLO.name} &lt;parceiro@exemplo.com.br&gt;
        </dd>
        <dt className="text-xs text-muted-foreground sm:pt-0.5">Assunto</dt>
        <dd className="font-medium">{assuntoFinal || "(sem assunto)"}</dd>
      </dl>
      <iframe
        title="Prévia do e-mail do convite"
        srcDoc={documento}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="block w-full bg-white"
        style={{ height: altura }}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (doc) setAltura(Math.min(Math.max(doc.documentElement.scrollHeight, 240), 1400));
        }}
      />
    </div>
  );
}

export interface ModeloParaPrevia {
  bodyText: string;
  buttons: WhatsAppButton[] | null;
  headerType: WhatsAppHeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
  footerText: string | null;
}

export function PreviaDoWhatsApp({
  modelo,
  variaveis,
}: {
  modelo: ModeloParaPrevia;
  variaveis: WhatsAppVariableMap;
}) {
  const valores = valoresDeExemplo(variaveis);
  return (
    <WhatsAppBubblePreview
      headerText={modelo.headerType === "text" ? modelo.headerText : null}
      headerMedia={headerMediaOf(modelo)}
      bodyText={fillVariables(modelo.bodyText, valores)}
      footerText={modelo.footerText}
      buttons={(modelo.buttons ?? []).map((b) => ({ text: b.text }))}
    />
  );
}
