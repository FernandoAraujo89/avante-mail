// Balão de prévia no estilo do WhatsApp (cores fixas, independentes do tema).
// Usado no editor de modelos e no wizard de campanhas.
export function WhatsAppBubblePreview({
  headerText,
  bodyText,
  footerText,
  buttons,
}: {
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: { text: string }[];
}) {
  const visibleButtons = (buttons ?? []).filter((b) => b.text.trim());

  return (
    <div className="rounded-xl bg-[#e5ddd5] p-4">
      <div className="max-w-full rounded-lg rounded-tl-none bg-white p-3 shadow-sm">
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
