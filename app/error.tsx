"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-destructive/15">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <CardTitle className="text-lg">Algo deu errado</CardTitle>
          <CardDescription className="break-words">
            {error.message || "Erro inesperado ao carregar a página."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">
              Se este é o primeiro acesso, confira:
            </p>
            <ol className="list-inside list-decimal space-y-1">
              <li>
                Copie o <code className="text-primary">.env.local.example</code>{" "}
                para <code className="text-primary">.env.local</code> e preencha
              </li>
              <li>
                Crie as tabelas: <code className="text-primary">npx drizzle-kit push</code>
              </li>
              <li>
                Popule os dados: <code className="text-primary">npx tsx scripts/seed.ts</code>
              </li>
            </ol>
          </div>
          <Button onClick={reset}>Tentar novamente</Button>
        </CardContent>
      </Card>
    </div>
  );
}
