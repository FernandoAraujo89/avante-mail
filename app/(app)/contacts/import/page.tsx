"use client";

import { useRef, useState } from "react";
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
    key: "segment",
    label: "Segmento",
    required: false,
    synonyms: ["segment", "segmento"],
  },
  {
    key: "tags",
    label: "Tags",
    required: false,
    synonyms: ["tags", "tag", "etiquetas"],
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const IGNORE = "__ignore__";

type ImportResult = {
  total: number;
  imported: number;
  duplicated: number;
  invalid: number;
};

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
    segment: IGNORE,
    tags: IGNORE,
  });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

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
        body: JSON.stringify({ csv, mapping: cleanMapping }),
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
                Colunas esperadas: name, email, company, segment, tags
                <br />
                (tags separadas por vírgula dentro da célula)
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
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
