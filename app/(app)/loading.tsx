/**
 * Estado de carregamento das rotas do app: a navegação responde na hora com
 * um esqueleto no lugar de congelar na tela anterior (visibilidade do status).
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando a página">
      <div className="mb-8 space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md bg-muted"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
