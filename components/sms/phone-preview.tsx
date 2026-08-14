// Prévia do SMS como ele chega no aparelho (cores fixas, independentes do
// tema, no mesmo espírito do balão de WhatsApp).
//
// O texto que chega aqui já deve estar TRANSLITERADO (sanitizeGsm7). É de
// propósito: a prévia existe justamente para a pessoa ver que "Promoção" sai
// como "Promocao" antes de mandar para dez mil pessoas, e não depois.
export function SmsPhonePreview({
  bodyText,
  senderLabel,
}: {
  bodyText: string;
  senderLabel?: string;
}) {
  return (
    <div className="rounded-xl bg-[#f2f2f7] p-4">
      <p className="mb-2 text-center text-[10px] font-medium tracking-wide text-[#8e8e93] uppercase">
        {senderLabel ?? "Mensagem"}
      </p>
      <div className="max-w-full rounded-2xl rounded-tl-sm bg-[#e5e5ea] px-3.5 py-2.5">
        {bodyText.trim() ? (
          // break-words impede que uma URL longa — presença garantida em SMS
          // de campanha — estoure a largura do balão.
          <p className="text-sm break-words whitespace-pre-wrap text-[#000000]">
            {bodyText}
          </p>
        ) : (
          <p className="text-sm text-[#8e8e93] italic">
            A mensagem aparece aqui conforme você escreve.
          </p>
        )}
      </div>
      <p className="mt-1 text-[10px] text-[#8e8e93]">Agora</p>
    </div>
  );
}
