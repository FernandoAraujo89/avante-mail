"use client";

import Link from "next/link";
import { MessageCircle, RotateCcw } from "lucide-react";

import { WhatsAppBubblePreview } from "@/components/whatsapp/bubble-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  extractVariables,
  fillVariables,
  type WhatsAppButton,
  type WhatsAppVariableExamples,
  type WhatsAppVariableMap,
} from "@/lib/whatsapp/types";
import { resolveVariables } from "@/lib/whatsapp/variables";

// Passo "Mensagem" do wizard para campanhas de WhatsApp: escolha do modelo
// aprovado + mapeamento das variáveis + prévia com contato de exemplo.

export type WaTemplateOption = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  headerType: "none" | "text";
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: WhatsAppButton[] | null;
  variableExamples: WhatsAppVariableExamples | null;
};

const SAMPLE_CONTACT = { name: "Parceiro Exemplo", company: "Empresa Exemplo" };

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
};

export function WhatsAppMessageStep({
  templates,
  selectedId,
  variables,
  onSelect,
  onVariablesChange,
}: {
  templates: WaTemplateOption[] | null;
  selectedId: string;
  variables: WhatsAppVariableMap;
  onSelect: (id: string) => void;
  onVariablesChange: (variables: WhatsAppVariableMap) => void;
}) {
  if (templates === null) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Carregando modelos...
      </p>
    );
  }

  const approved = templates.filter((t) => t.status === "approved");
  const selected = approved.find((t) => t.id === selectedId) ?? null;

  if (!selected) {
    return (
      // @container: este passo aparece tanto na largura do wizard quanto no
      // painel estreito da automação. As colunas respondem ao ESPAÇO REAL do
      // componente, não à largura da janela — que é o que fazia os modelos
      // ficarem espremidos e o nome vazar por cima do vizinho.
      <div className="@container space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Escolha o modelo da mensagem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Campanhas de WhatsApp só podem usar modelos aprovados pela Meta.
          </p>
        </div>

        {approved.length === 0 ? (
          <Card className="max-w-xl">
            <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="size-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">Nenhum modelo aprovado ainda</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crie um modelo e envie para análise da Meta — a aprovação
                  costuma sair em minutos.
                </p>
              </div>
              <Button asChild>
                <Link href="/whatsapp-templates">Gerenciar modelos</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 @md:grid-cols-2 @4xl:grid-cols-3">
            {approved.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template.id)}
                className="flex min-h-32 flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 @md:p-5"
              >
                {/* min-w-0 é o que autoriza o truncate dentro do grid: sem ele
                    o item fica do tamanho do conteúdo e o nome vaza. */}
                <div className="min-w-0">
                  <p
                    className="truncate font-mono text-sm font-medium"
                    title={template.name}
                  >
                    {template.name}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {template.bodyText}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  {CATEGORY_LABELS[template.category] ?? template.category}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const indexes = extractVariables(selected.bodyText);
  const previewValues = resolveVariables({
    bodyText: selected.bodyText,
    variables,
    examples: selected.variableExamples,
    contact: SAMPLE_CONTACT,
  });

  function setVariableSource(n: number, kind: string) {
    const key = String(n);
    const current = variables[key];
    const next: WhatsAppVariableMap = { ...variables };
    if (kind === "name") next[key] = { source: "name" };
    else if (kind === "company") next[key] = { source: "company" };
    else if (kind === "static") {
      next[key] = {
        source: "static",
        value: current?.source === "static" ? (current.value ?? "") : "",
      };
    }
    onVariablesChange(next);
  }

  function setStaticValue(n: number, value: string) {
    onVariablesChange({
      ...variables,
      [String(n)]: { source: "static", value },
    });
  }

  return (
    // Prévia ao lado só quando cabe de verdade (≈ 56rem de componente); abaixo
    // disso ela vai para baixo, em vez de espremer as duas colunas.
    <div className="@container grid items-start gap-6 @4xl:grid-cols-[1fr_360px]">
      <Card>
        <CardContent className="grid gap-5 p-4 @md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Modelo:</span>
              <span
                className="truncate font-mono font-medium"
                title={selected.name}
              >
                {selected.name}
              </span>
              <Badge variant="outline" className="shrink-0">
                {CATEGORY_LABELS[selected.category] ?? selected.category}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onSelect("")}>
              <RotateCcw />
              Trocar modelo
            </Button>
          </div>

          {indexes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este modelo não tem variáveis — a mensagem é igual para todos os
              destinatários.
            </p>
          ) : (
            <div className="grid gap-2.5">
              <Label>Variáveis da mensagem</Label>
              <p className="-mt-1 text-xs text-muted-foreground">
                Defina de onde vem o valor de cada variável, contato a contato.
              </p>
              {indexes.map((n) => {
                const source = variables[String(n)];
                return (
                  <div key={n} className="flex flex-wrap items-center gap-2">
                    <span className="w-14 shrink-0 rounded bg-muted px-2 py-1 text-center font-mono text-xs">
                      {`{{${n}}}`}
                    </span>
                    <Select
                      value={source?.source}
                      onValueChange={(value) => setVariableSource(n, value)}
                    >
                      {/* Largura fixa só quando sobra espaço: no painel
                          estreito o seletor ocupa a linha inteira. */}
                      <SelectTrigger className="w-full @sm:w-48">
                        <SelectValue placeholder="Escolher fonte" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Nome do contato</SelectItem>
                        <SelectItem value="company">
                          Empresa do contato
                        </SelectItem>
                        <SelectItem value="static">Texto fixo</SelectItem>
                      </SelectContent>
                    </Select>
                    {source?.source === "static" ? (
                      <Input
                        value={source.value ?? ""}
                        onChange={(e) => setStaticValue(n, e.target.value)}
                        placeholder="Texto enviado a todos"
                        className="w-full flex-1 @sm:min-w-48"
                      />
                    ) : null}
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Contato sem o campo (ex.: sem empresa) recebe o exemplo do
                modelo.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="@4xl:sticky @4xl:top-6">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Prévia (contato de exemplo)
        </p>
        <WhatsAppBubblePreview
          headerText={selected.headerType === "text" ? selected.headerText : null}
          bodyText={fillVariables(selected.bodyText, previewValues)}
          footerText={selected.footerText}
          buttons={selected.buttons ?? []}
        />
      </div>
    </div>
  );
}
