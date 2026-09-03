import { createHash } from "crypto";
import dns from "dns/promises";
import { promises as fs } from "fs";
import net from "net";
import path from "path";

import type { Block, EmailDesign, Row } from "./email-builder/types";
import type { RelatorioImagens } from "./imagens-relatorio";
import {
  ALLOWED_UPLOAD_TYPES,
  getUploadsDir,
  MAX_UPLOAD_BYTES,
} from "./uploads";

/**
 * Traz para o servidor as imagens que o e-mail busca em outros domínios.
 *
 * Uma imagem hospedada fora é uma dependência de entrega: o dia em que o site
 * de origem sai do ar, muda o caminho ou passa a barrar hotlink, o e-mail que
 * JÁ FOI ENVIADO aparece quebrado na caixa de entrada — e não há como
 * consertar depois. Por isso a imagem externa é baixada uma vez, guardada no
 * banco de imagens e o endereço no e-mail passa a apontar para cá.
 *
 * O nome do arquivo é o hash do conteúdo: importar duas vezes o mesmo e-mail,
 * ou dois e-mails que usam a mesma arte, não multiplica arquivo no disco.
 *
 * Falha em baixar nunca interrompe o trabalho: o endereço original fica como
 * está e o relatório diz o que não veio, para a pessoa decidir.
 */

/** Teto de imagens por e-mail — protege contra um HTML colado com centenas. */
const MAX_IMAGENS = 60;
const TIMEOUT_MS = 10_000;

/** MIME → extensão, restrito ao que o banco de imagens aceita. */
const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
};

export type { RelatorioImagens } from "./imagens-relatorio";

function ehExterna(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * Endereço que resolve para a própria rede não é baixado.
 *
 * O endereço vem de um HTML que alguém colou, e quem busca é o servidor:
 * sem esta trava, colar `http://169.254.169.254/...` faria o servidor buscar
 * um recurso interno e guardá-lo num arquivo público.
 */
function ehIpPrivado(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    v6.startsWith("::ffff:")
  );
}

/** null = pode buscar; string = o motivo de não buscar, já em português. */
async function motivoParaNaoBuscar(host: string): Promise<string | null> {
  if (net.isIP(host)) {
    return ehIpPrivado(host) ? "endereço da rede interna" : null;
  }
  let enderecos;
  try {
    enderecos = await dns.lookup(host, { all: true });
  } catch {
    // Domínio que não resolve é o caso mais comum de imagem quebrada: dizer
    // "não é público" mandaria a pessoa procurar o problema no lugar errado.
    return "domínio não encontrado";
  }
  if (enderecos.length === 0) return "domínio não encontrado";
  return enderecos.every((e) => !ehIpPrivado(e.address))
    ? null
    : "endereço da rede interna";
}

/**
 * Baixa uma vez cada endereço e devolve sempre o mesmo caminho local.
 * A instância vive por operação (um import, um salvamento).
 */
class Baixador {
  private cache = new Map<string, string | null>();
  readonly relatorio: RelatorioImagens = { baixadas: 0, falhas: [] };

  private registrarFalha(url: string, motivo: string) {
    if (!this.relatorio.falhas.some((f) => f.url === url)) {
      this.relatorio.falhas.push({ url, motivo });
    }
  }

  /** `/uploads/<arquivo>` para a imagem externa, ou null se ela não veio. */
  async caminhoLocal(url: string): Promise<string | null> {
    const chave = url.trim();
    const emCache = this.cache.get(chave);
    if (emCache !== undefined) return emCache;

    const resultado = await this.baixar(chave);
    this.cache.set(chave, resultado);
    return resultado;
  }

  private async baixar(url: string): Promise<string | null> {
    if (this.cache.size >= MAX_IMAGENS) {
      this.registrarFalha(url, `limite de ${MAX_IMAGENS} imagens por e-mail`);
      return null;
    }

    let alvo: URL;
    try {
      alvo = new URL(url);
    } catch {
      this.registrarFalha(url, "endereço inválido");
      return null;
    }
    if (alvo.protocol !== "http:" && alvo.protocol !== "https:") {
      this.registrarFalha(url, "protocolo não suportado");
      return null;
    }
    const impedimento = await motivoParaNaoBuscar(alvo.hostname);
    if (impedimento) {
      this.registrarFalha(url, impedimento);
      return null;
    }

    let resposta: Response;
    try {
      resposta = await fetch(alvo, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      this.registrarFalha(url, "o servidor da imagem não respondeu");
      return null;
    }
    if (!resposta.ok) {
      this.registrarFalha(url, `resposta ${resposta.status}`);
      return null;
    }

    const mime = (resposta.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const ext = EXTENSAO_POR_MIME[mime];
    if (!ext || !ALLOWED_UPLOAD_TYPES[ext]) {
      this.registrarFalha(url, `tipo não suportado (${mime || "desconhecido"})`);
      return null;
    }

    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.length === 0) {
      this.registrarFalha(url, "arquivo vazio");
      return null;
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      this.registrarFalha(url, "imagem acima de 5MB");
      return null;
    }

    // Nome pelo conteúdo: a mesma arte, vinda de dois e-mails ou importada
    // duas vezes, é um arquivo só.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const nome = `externa-${hash}.${ext}`;
    const dir = getUploadsDir();
    const destino = path.join(dir, nome);

    try {
      await fs.mkdir(dir, { recursive: true });
      // `wx` falha se já existe: o arquivo idêntico já está salvo.
      await fs.writeFile(destino, bytes, { flag: "wx" });
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code;
      if (codigo !== "EEXIST") {
        this.registrarFalha(url, "não foi possível gravar no servidor");
        return null;
      }
    }

    this.relatorio.baixadas += 1;
    return `/uploads/${nome}`;
  }
}

/** Endereços de imagem que aparecem num HTML: `<img src>` e `background=`. */
function enderecosDeImagem(html: string): string[] {
  const achados = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*"([^"]+)"/gi)) {
    achados.add(m[1]);
  }
  // VML do Outlook (fundo de seção) e o atributo background das tabelas.
  for (const m of html.matchAll(/\sbackground\s*=\s*"(https?:[^"]+)"/gi)) {
    achados.add(m[1]);
  }
  for (const m of html.matchAll(/url\((?:'|")?(https?:[^'")]+)(?:'|")?\)/gi)) {
    achados.add(m[1]);
  }
  return [...achados].filter(ehExterna);
}

function trocarTodas(html: string, de: string, para: string): string {
  return html.split(de).join(para);
}

async function internalizarEmHtml(
  html: string,
  baixador: Baixador
): Promise<string> {
  let saida = html;
  for (const url of enderecosDeImagem(html)) {
    const local = await baixador.caminhoLocal(url);
    if (local) saida = trocarTodas(saida, url, local);
  }
  return saida;
}

/** HTML (ou MJML) com as imagens externas trazidas para o servidor. */
export async function internalizarImagensDoHtml(
  html: string
): Promise<{ html: string; relatorio: RelatorioImagens }> {
  const baixador = new Baixador();
  const saida = await internalizarEmHtml(html, baixador);
  return { html: saida, relatorio: baixador.relatorio };
}

async function internalizarBloco(
  block: Block,
  baixador: Baixador
): Promise<Block> {
  let saida: Block = block;

  if (saida.customHtml) {
    saida = {
      ...saida,
      customHtml: await internalizarEmHtml(saida.customHtml, baixador),
    };
  }
  if (saida.type === "text") {
    saida = { ...saida, html: await internalizarEmHtml(saida.html, baixador) };
  }
  if (saida.type === "image" && ehExterna(saida.src)) {
    const local = await baixador.caminhoLocal(saida.src);
    if (local) saida = { ...saida, src: local };
  }
  if (saida.type === "social") {
    const items = [];
    for (const item of saida.items) {
      if (!ehExterna(item.iconSrc)) {
        items.push(item);
        continue;
      }
      const local = await baixador.caminhoLocal(item.iconSrc);
      items.push(local ? { ...item, iconSrc: local } : item);
    }
    saida = { ...saida, items };
  }

  return saida;
}

async function internalizarLinha(row: Row, baixador: Baixador): Promise<Row> {
  const colunas = [];
  for (const col of row.columns) {
    const blocos = [];
    for (const bloco of col.blocks) {
      blocos.push(await internalizarBloco(bloco, baixador));
    }
    colunas.push({ ...col, blocks: blocos });
  }
  return {
    ...row,
    ...(row.customHtml
      ? { customHtml: await internalizarEmHtml(row.customHtml, baixador) }
      : {}),
    columns: colunas,
  };
}

/** Design do Criador com as imagens externas trazidas para o servidor. */
export async function internalizarImagensDoDesign(
  design: EmailDesign
): Promise<{ design: EmailDesign; relatorio: RelatorioImagens }> {
  const baixador = new Baixador();
  const rows = [];
  for (const row of design.rows) {
    rows.push(await internalizarLinha(row, baixador));
  }
  return {
    design: {
      ...design,
      ...(design.customHtml
        ? { customHtml: await internalizarEmHtml(design.customHtml, baixador) }
        : {}),
      rows,
    },
    relatorio: baixador.relatorio,
  };
}
