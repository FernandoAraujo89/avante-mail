"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { CheckCircle2, FileUp, Upload } from "lucide-react";

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
    label: "E-mail",
    required: true,
    synonyms: ["email", "e-mail", "e_mail"],
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
    label: "Telefone (WhatsApp)",
    required: false,
    synonyms: ["phone", "telefone", "celular", "whatsapp", "fone"],
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

type ImportResult = {
  total: number;
  imported: number;
  duplicated: number;
  invalid: number;
  phoneInvalid: number;
  addedToList: number;
};

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
    if (mapping.name === IGNORE || mapping.email === IGNORE) {
      setError("Mapeie ao menos as colunas de Nome e E-mail.");
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
        title="Importar contatos"
        description="Envie um arquivo CSV e mapeie as colunas para os campos da base."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-hover">
          {error}
        </div>
      ) : null}

      {result ? (
        <Card className="max-w-xl">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-success-light/40">
              <CheckCircle2 className="size-5 text-success-dark" />
            </div>
            <CardTitle>Importação concluída</CardTitle>
            <CardDescription>
              Resultado do arquivo{" "}
              <span className="text-foreground">{fileName}</span>:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              <li>
                <span className="font-semibold text-success-dark">
                  {result.imported}
                </span>{" "}
                contatos importados
              </li>
              <li>
                <span className="font-semibold">{result.duplicated}</span>{" "}
                ignorados por e-mail duplicado
              </li>
              <li>
                <span className="font-semibold">{result.invalid}</span>{" "}
                linhas inválidas (sem nome ou e-mail válido)
              </li>
              {result.phoneInvalid > 0 ? (
                <li>
                  <span className="font-semibold">{result.phoneInvalid}</span>{" "}
                  telefones inválidos (contato importado sem telefone)
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
              <li className="text-muted-foreground">
                {result.total} linhas no arquivo
              </li>
            </ul>
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
                Colunas esperadas: name, email, company, tags, telefone,
                aceita_whatsapp
                <br />
                (tags separadas por vírgula. A coluna aceita_whatsapp é
                opcional: sem ela, todo contato com telefone entra aceitando
                WhatsApp; com ela, só quem estiver como sim/1/true aceita —
                use-a para registrar quem não autorizou)
                <br />
                O telefone pode vir em qualquer formato com DDD (ex.: (31)
                99576-8114 ou 31995768114). Se a célula tiver vários números
                separados por vírgula, o primeiro válido é usado.
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
                        <TableCell key={header} className="text-muted-foreground">
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
