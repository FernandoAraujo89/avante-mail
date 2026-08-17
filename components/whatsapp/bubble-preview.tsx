import { FileText } from "lucide-react";

import { isMediaHeader, type WhatsAppHeaderType } from "@/lib/whatsapp/types";

// Balão de prévia no estilo do WhatsApp (cores fixas, independentes do tema).
// Usado no editor de modelos e no wizard de campanhas.

/** Cabeçalho de arquivo do modelo: imagem exibida ou card de PDF. */
export type BubbleHeaderMedia = {
  kind: "image" | "document";
  url: string;
  filename?: string | null;
};

/** Cabeçalho de um modelo salvo no formato que a prévia espera. */
export function headerMediaOf(template: {
  headerType: WhatsAppHeaderType;
  headerMediaUrl: string | null;
  headerMediaFilename: string | null;
}): BubbleHeaderMedia | null {
  if (!isMediaHeader(template.headerType) || !template.headerMediaUrl) {
    return null;
  }
  return {
    kind: template.headerType,
    url: template.headerMediaUrl,
    filename: template.headerMediaFilename,
  };
}

export function WhatsAppBubblePreview({
  headerText,
  headerMedia,
  bodyText,
  footerText,
  buttons,
}: {
  headerText?: string | null;
  headerMedia?: BubbleHeaderMedia | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: { text: string }[];
}) {
  const visibleButtons = (buttons ?? []).filter((b) => b.text.trim());

  return (
    <div className="rounded-xl bg-[#e5ddd5] p-4">
      <div className="max-w-full rounded-lg rounded-tl-none bg-white p-3 shadow-sm">
        {headerMedia?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headerMedia.url}
            alt=""
            className="mb-2 max-h-44 w-full rounded-md object-cover"
          />
        ) : null}
        {headerMedia?.kind === "document" ? (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-[#f5f6f6] p-2.5">
            <FileText className="size-6 shrink-0 text-[#d93025]" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-[#111b21]">
                {headerMedia.filename?.trim() || "documento.pdf"}
              </p>
              <p className="text-[10px] uppercase text-[#8696a0]">PDF</p>
            </div>
          </div>
        ) : null}
        {headerText ? (
          <p className="mb-1 text-sm font-semibold text-[#111b21]">
            {headerText}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-sm text-[#111b21]">{bodyText}</p>
        {footerText ? (
          <p className="mt-1.5 text-xs text-[#8696a0]">{footerText}</p>
        ) : null}
        <p className="mt-1 text-right text-[10px] text-[#8696a0]">12:00</p>
      </div>
      {visibleButtons.length > 0 ? (
        <div className="mt-1 grid gap-1">
          {visibleButtons.map((button, index) => (
            <div
              key={index}
              className="rounded-lg bg-white py-2 text-center text-sm font-medium text-[#00a5f4] shadow-sm"
            >
              {button.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
