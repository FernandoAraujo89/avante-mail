import { ListChecks, MessageCircle, MessagesSquare, ScanSearch } from "lucide-react";

// O "por quê" da pesquisa no painel azul da página do parceiro: por que a
// Avante está fazendo o Mapeamento da Parceria e o que a resposta dele muda.
// Vale para as três fases (o projeto é um só). Os três pontos repetem o que a
// Mayra diz no vídeo da Fase 1 — conhecer a operação, decidir melhorias e dar
// um retorno —, para a página e o vídeo contarem a mesma história.
//
// Texto no tom de voz da Avante (skill tom-de-voz-avante): "você", "a gente",
// "pra", frase curta. Contraste: branco e branco/80 sobre o azul primário
// (≥ 4,5:1); nada abaixo de /80 em texto.

/** O número Avante Expansão (o mesmo que manda o convite por WhatsApp). */
export const WHATSAPP_DA_EXPANSAO = {
  exibicao: "(37) 99876-0551",
  link: "https://wa.me/5537998760551",
};

const PONTOS = [
  {
    icone: ScanSearch,
    titulo: "Conhecer você de perto",
    texto: "Cada operação é diferente. A gente quer entender a sua, sem achismo.",
  },
  {
    icone: ListChecks,
    titulo: "Decidir o que melhorar",
    texto: "Suas respostas entram no planejamento da Avante pros próximos meses.",
  },
  {
    icone: MessageCircle,
    titulo: "Te dar um retorno",
    texto: "A Expansão volta a falar com você sobre o que vai ser feito.",
  },
] as const;

export function PorQueResponder() {
  return (
    <div className="grid gap-8">
      <section>
        <h2 className="text-xs font-medium tracking-wider text-primary-foreground uppercase">
          Por que a Avante está fazendo isso
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-primary-foreground/80">
          A Avante cresce junto com os parceiros. Pra apoiar cada um do jeito certo, a
          equipe de Expansão quer conhecer a realidade de cada operação — não uma média
          de todas.
        </p>
      </section>

      <section>
        <h2 className="text-xs font-medium tracking-wider text-primary-foreground uppercase">
          Por que a sua resposta importa
        </h2>
        <ul className="mt-4 grid max-w-md gap-4">
          {PONTOS.map(({ icone: Icone, titulo, texto }) => (
            <li key={titulo} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <Icone className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{titulo}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-primary-foreground/80">{texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-start gap-2 text-sm text-primary-foreground/80">
        <MessagesSquare className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Ficou com dúvida? Chama a Expansão no WhatsApp:{" "}
          <a
            href={WHATSAPP_DA_EXPANSAO.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium whitespace-nowrap text-primary-foreground underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            {WHATSAPP_DA_EXPANSAO.exibicao}
          </a>
        </span>
      </p>
    </div>
  );
}
