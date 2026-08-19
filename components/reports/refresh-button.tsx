"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Atualiza o relatório sob demanda — e sozinho, a cada 10s, enquanto o
 * disparo está em andamento. O relatório é renderizado no servidor; sem
 * isto os números congelam e nada diz que é preciso recarregar a página.
 */
export function RefreshButton({ autoRefresh }: { autoRefresh: boolean }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh, router]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        setRefreshing(true);
        router.refresh();
        setTimeout(() => setRefreshing(false), 800);
      }}
      title={
        autoRefresh
          ? "Envio em andamento — o relatório se atualiza sozinho a cada 10s"
          : "Recarregar os números do relatório"
      }
    >
      <RefreshCw
        className={refreshing || autoRefresh ? "animate-spin" : undefined}
      />
      Atualizar
    </Button>
  );
}
