"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { CheckCircle2, Download, FileUp, Upload } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { csvFilename, toCsv } from "@/lib/csv";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FIELDS = [
  { key: "name", label: "Nome", required: true, synonyms: ["name", "nome"] },
  {
    key: "email",
    label: "E-mail(s)",
    required: false,
    synonyms: ["email", "e-mail", "e_mail", "emails"],
  },
  {
    key: "company",
    label: "Empresa",
    required: false,
    synonyms: ["company", "empresa", "loja"],
  },
  {
    key: "tags",
    label: "Tags",
    required: false,
    synonyms: ["tags", "tag", "etiquetas"],
  },
  {
    key: "phone",
    label: "Telefone(s)",
    required: false,
    synonyms: [
      "phone",
      "telefone",
      "celular",
      "whatsapp",
      "fone",
      "telefones",
      "numero",
      "número",
    ],
  },
  {
    key: "whatsappOptIn",
    label: "Aceita WhatsApp",
    required: false,
    synonyms: [
      "aceita_whatsapp",
      "whatsapp_opt_in",
      "opt_in_whatsapp",
      "optin",
      "consentimento",
    ],
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const IGNORE = "__ignore__";
const NO_LIST = "__none__";

type Pendencia = {
  linha: number;
  nome: string;
  valores: string;
  motivo: string;
};

type ImportResult = {
  total: number;
  criados: number;
  atualizados: number;
  semMudanca: number;
  emailsAdicionados: number;
  telefonesAdicionados: number;
  telefonesInvalidos: number;
  addedToList: number;
  pendencias: Pendencia[];
  pendenciasOmitidas: number;
};

function baixarArquivo(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

type ListRef = { id: string; name: string };

export default function ImportContactsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({
    name: IGNORE,
    email: IGNORE,
    company: IGNORE,
    tags: IGNORE,
    phone: IGNORE,
    whatsappOptIn: IGNORE,
  });
  const [availableLists, setAvailableLists] = useState<ListRef[]>([]);
  const [targetListId, setTargetListId] = useState(NO_LIST);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/lists");
        if (res.ok) setAvailableLists(await res.json());
      } catch {
        // silencioso: importação sem lista continua funcionando
      }
    })();
    // Pré-seleciona a lista quando vem de /lists/[id] (?listId=...).
    const preset = new URLSearchParams(window.location.search).get("listId");
    if (preset) setTargetListId(preset);
  }, []);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        preview: 6,
        transformHeader: (header) => header.trim(),
      });

      const fields = parsed.meta.fields ?? [];
      if (fields.length === 0) {
        setError("Não foi possível ler o cabeçalho do CSV.");
        return;
      }

      const autoMapping = { ...mapping };
      for (const field of FIELDS) {
        const match = fields.find((h) =>
          (field.synonyms as readonly string[]).includes(h.toLowerCase().trim())
        );
        autoMapping[field.key] = match ?? IGNORE;
      }

      setFileName(file.name);
      setCsv(text);
      setHeaders(fields);
      setPreviewRows(parsed.data.slice(0, 5));
      setMapping(autoMapping);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (mapping.name === IGNORE) {
      setError("Mapeie a coluna de Nome.");
      return;
    }
    if (mapping.email === IGNORE && mapping.phone === IGNORE) {
      setError("Mapeie a coluna de E-mail, a de Telefone ou as duas.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const cleanMapping: Record<string, string> = {};
      for (const field of FIELDS) {
        if (mapping[field.key] !== IGNORE) {
          cleanMapping[field.key] = mapping[field.key];
        }
      }

      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          mapping: cleanMapping,
          listId: targetListId !== NO_LIST ? targetListId : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao importar contatos.");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setFileName("");
    setCsv("");
    setHeaders([]);
    setPreviewRows([]);
    setResult(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      <PageHeader
        title="Importar ou atualizar contatos"
        description="Envie um CSV com nome e telefone (e-mail opcional). Quem já existe ganha os endereços novos; quem não existe é criado."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {result ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-success-light/40">
              <CheckCircle2 className="size-5 text-success-dark" />
            </div>
            <CardTitle>Importação concluída</CardTitle>
            <CardDescription>
              Resultado do arquivo{" "}
              <span className="text-foreground">{fileName}</span> (
              {result.total} linha{result.total === 1 ? "" : "s"}):
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-1 text-sm">
              <li>
                <span className="font-semibold text-success-dark">
                  {result.criados}
                </span>{" "}
                contato{result.criados === 1 ? "" : "s"} novo
                {result.criados === 1 ? "" : "s"}
              </li>
              <li>
                <span className="font-semibold text-primary">
                  {result.atualizados}
                </span>{" "}
                contato{result.atualizados === 1 ? "" : "s"} que já existia
                {result.atualizados === 1 ? "" : "m"} e ganh
                {result.atualizados === 1 ? "ou" : "aram"} dados novos
                {result.emailsAdicionados + result.telefonesAdicionados > 0
                  ? ` (${result.telefonesAdicionados} telefone${
                      result.telefonesAdicionados === 1 ? "" : "s"
                    } e ${result.emailsAdicionados} e-mail${
                      result.emailsAdicionados === 1 ? "" : "s"
                    } acrescentados no total)`
                  : ""}
              </li>
              {result.semMudanca > 0 ? (
                <li>
                  <span className="font-semibold">{result.semMudanca}</span> já
                  estava{result.semMudanca === 1 ? "" : "m"} iguais (nada a
                  mudar)
                </li>
              ) : null}
              {result.telefonesInvalidos > 0 ? (
                <li>
                  <span className="font-semibold">
                    {result.telefonesInvalidos}
                  </span>{" "}
                  célula{result.telefonesInvalidos === 1 ? "" : "s"} de telefone
                  sem número válido (a linha entrou pelo resto)
                </li>
              ) : null}
              {result.addedToList > 0 ? (
                <li>
                  <span className="font-semibold text-primary">
                    {result.addedToList}
                  </span>{" "}
                  adicionados à lista escolhida
                </li>
              ) : null}
            </ul>

            {result.pendencias.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {result.pendencias.length + result.pendenciasOmitidas} linha
                    {result.pendencias.length + result.pendenciasOmitidas === 1
                      ? ""
                      : "s"}{" "}
                    ficaram para você decidir
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      baixarArquivo(
                        csvFilename("pendencias", fileName),
                        toCsv(
                          ["linha", "nome", "e-mails e telefones", "motivo"],
                          result.pendencias.map((p) => [
                            String(p.linha),
                            p.nome,
                            p.valores,
                            p.motivo,
                          ])
                        )
                      )
                    }
                  >
                    <Download />
                    Baixar CSV
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Nome repetido na base, e-mail de um contato com telefone de
                  outro, ou linha sem dado válido. Nada dessas linhas foi
                  gravado: resolva na tela do contato e importe de novo só elas,
                  se quiser.
                </p>
                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Linha</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>E-mails e telefones</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.pendencias.map((p) => (
                        <TableRow key={p.linha}>
                          <TableCell className="text-muted-foreground">
                            {p.linha}
                          </TableCell>
                          <TableCell>{p.nome || "—"}</TableCell>
                          <TableCell className="break-all text-muted-foreground">
                            {p.valores || "—"}
                          </TableCell>
                          <TableCell>{p.motivo}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {result.pendenciasOmitidas > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Mostrando as {result.pendencias.length} primeiras; mais{" "}
                    {result.pendenciasOmitidas} no arquivo original.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button asChild>
                <Link href="/contacts">Ver contatos</Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                Importar outro arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : csv === "" ? (
        <Card className="max-w-xl">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <FileUp className="size-6 text-primary" />
            </div>
            <div>
              <p className="font-medium">Selecione o arquivo CSV</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Colunas: nome, telefone, email, empresa, tags, aceita_whatsapp —
                só o nome é obrigatório, com telefone ou e-mail.
                <br />
                Quem já está na base (mesmo e-mail, mesmo telefone ou mesmo
                nome, se for um só) ganha os telefones e e-mails que faltavam;
                quem não está vira contato novo. Uma célula pode trazer vários
                números ou e-mails separados por vírgula — todos entram.
                <br />O telefone pode vir em qualquer formato com DDD (ex.: (31)
                99576-8114 ou 31995768114). A coluna aceita_whatsapp é opcional:
                sem ela, todo telefone entra aceitando WhatsApp e SMS; com ela,
                só quem estiver como sim/1/true aceita.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="hidden"
              id="csv-file"
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload />
              Escolher arquivo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mapeamento de colunas</CardTitle>
              <CardDescription>
                Arquivo: <span className="text-foreground">{fileName}</span> —
                associe cada campo a uma coluna do CSV.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FIELDS.map((field) => (
                  <div key={field.key} className="grid gap-2">
                    <Label>
                      {field.label}
                      {field.required ? " *" : ""}
                    </Label>
                    <Select
                      value={mapping[field.key]}
                      onValueChange={(value) =>
                        setMapping((m) => ({ ...m, [field.key]: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>— Ignorar —</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="grid gap-2 border-t border-border pt-5 sm:max-w-sm">
                <Label>Adicionar à lista</Label>
                <Select value={targetListId} onValueChange={setTargetListId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LIST}>— Nenhuma lista —</SelectItem>
                    {availableLists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Os contatos do arquivo (novos e já existentes) entram nesta
                  lista.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prévia (5 primeiras linhas)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, index) => (
                    <TableRow key={index}>
                      {headers.map((header) => (
                        <TableCell
                          key={header}
                          className="text-muted-foreground"
                        >
                          {row[header] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={handleImport} disabled={importing}>
              {importing ? "Importando..." : "Importar contatos"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={importing}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
