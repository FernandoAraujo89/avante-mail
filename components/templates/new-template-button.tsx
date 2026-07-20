"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, MousePointerClick, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const OPTIONS = [
  {
    key: "builder" as const,
    icon: MousePointerClick,
    title: "Criador de email",
    description:
      "Monte o e-mail visualmente com estruturas, blocos e módulos salvos.",
    href: "/templates/builder",
  },
  {
    key: "code" as const,
    icon: Code2,
    title: "HTML personalizado",
    description: "Escreva ou cole o código do e-mail (MJML ou HTML puro).",
    href: "/templates/new",
  },
];

export function NewTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"builder" | "code">("builder");

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Novo template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Escolha um tipo de modelo</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setChoice(option.key)}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-xl border-2 p-6 text-center transition-colors",
                  choice === option.key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div
                  className={cn(
                    "flex size-14 items-center justify-center rounded-lg",
                    choice === option.key
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary text-muted-foreground"
                  )}
                >
                  <option.icon className="size-7" />
                </div>
                <p className="font-semibold">{option.title}</p>
                <p className="text-xs text-muted-foreground">
                  {option.description}
                </p>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                router.push(
                  OPTIONS.find((o) => o.key === choice)?.href ??
                    "/templates/builder"
                );
              }}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
