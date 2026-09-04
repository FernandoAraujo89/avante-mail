import { Sidebar } from "@/components/sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="min-h-screen pt-14 md:ml-60 md:pt-0 print:ml-0 print:pt-0">
        {/* 96rem (1536px): em monitor largo, tabelas como a de leads cabem
            inteiras em vez de cortar a última coluna enquanto sobra tela vazia
            dos lados; o teto ainda segura a linha de leitura. */}
        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
