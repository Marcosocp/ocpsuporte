// Anexos dos chamados: prints, PDFs, planilhas, logs. Ficam fora da pasta pública, com nome gerado por nós,
// e só são servidos depois de conferir que quem pede pode ver o chamado e a mensagem.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import multer from "multer";
import type { PoolConnection } from "mysql2/promise";
import { config } from "./config.js";

export const MAX_ANEXOS = 5;
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO, files: MAX_ANEXOS, fields: 30, fieldSize: 100 * 1024 },
});

// Tipos aceitos: extensão → tipo servido e assinatura dos primeiros bytes (quando o formato tem uma).
// Imagens abrem no navegador; o resto é sempre baixado. SVG/HTML nunca (poderiam rodar script).
const TIPOS: Record<string, { mime: string; inicio?: number[][]; imagem?: boolean }> = {
  png: { mime: "image/png", inicio: [[0x89, 0x50, 0x4e, 0x47]], imagem: true },
  jpg: { mime: "image/jpeg", inicio: [[0xff, 0xd8, 0xff]], imagem: true },
  jpeg: { mime: "image/jpeg", inicio: [[0xff, 0xd8, 0xff]], imagem: true },
  gif: { mime: "image/gif", inicio: [[0x47, 0x49, 0x46, 0x38]], imagem: true },
  webp: { mime: "image/webp", inicio: [[0x52, 0x49, 0x46, 0x46]], imagem: true },
  pdf: { mime: "application/pdf", inicio: [[0x25, 0x50, 0x44, 0x46]] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inicio: [[0x50, 0x4b]] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inicio: [[0x50, 0x4b]] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inicio: [[0x50, 0x4b]] },
  zip: { mime: "application/zip", inicio: [[0x50, 0x4b]] },
  doc: { mime: "application/msword", inicio: [[0xd0, 0xcf, 0x11, 0xe0]] },
  xls: { mime: "application/vnd.ms-excel", inicio: [[0xd0, 0xcf, 0x11, 0xe0]] },
  msg: { mime: "application/vnd.ms-outlook", inicio: [[0xd0, 0xcf, 0x11, 0xe0]] },
  eml: { mime: "message/rfc822" },
  txt: { mime: "text/plain" },
  log: { mime: "text/plain" },
  csv: { mime: "text/csv" },
  xml: { mime: "application/xml" },
  json: { mime: "application/json" },
};

export const EXTENSOES_ACEITAS = Object.keys(TIPOS).map((e) => `.${e}`).join(",");

export class AnexoInvalido extends Error {}

const extensao = (nome: string) => path.extname(nome).slice(1).toLowerCase();

// multer entrega o nome em latin1; navegadores mandam UTF-8.
const nomeOriginal = (f: Express.Multer.File) =>
  Buffer.from(f.originalname, "latin1").toString("utf8").replace(/[\\/\x00-\x1f]/g, "_").slice(-200) || "arquivo";

export function validarAnexos(arquivos: Express.Multer.File[]): void {
  for (const f of arquivos) {
    const nome = nomeOriginal(f);
    const tipo = TIPOS[extensao(nome)];
    if (!tipo) throw new AnexoInvalido(`Tipo de arquivo não aceito: ${nome}. Aceitos: imagens, PDF, Office, ZIP, texto e logs.`);
    if (!f.size) throw new AnexoInvalido(`Arquivo vazio: ${nome}.`);
    if (tipo.inicio && !tipo.inicio.some((m) => m.every((b, i) => f.buffer[i] === b))) {
      throw new AnexoInvalido(`O conteúdo de ${nome} não corresponde à extensão.`);
    }
  }
}

/** Grava os arquivos e registra os anexos da mensagem (dentro da transação de quem chama). */
export async function salvarAnexos(
  conexao: PoolConnection, arquivos: Express.Multer.File[], chamadoId: number, mensagemId: number, usuarioId: number,
): Promise<void> {
  if (!arquivos.length) return;
  await mkdir(config.pastaAnexos, { recursive: true, mode: 0o700 });
  for (const f of arquivos) {
    const nome = nomeOriginal(f);
    const arquivo = randomUUID();
    await writeFile(path.join(config.pastaAnexos, arquivo), f.buffer, { mode: 0o600, flag: "wx" });
    await conexao.query(
      "INSERT INTO anexos (chamado_id, mensagem_id, nome, arquivo, tipo, tamanho, enviado_por) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [chamadoId, mensagemId, nome, arquivo, TIPOS[extensao(nome)].mime, f.size, usuarioId],
    );
  }
}

export function servirAnexo(res: Response, anexo: { nome: string; arquivo: string; tipo: string }, baixar: boolean): void {
  const imagem = TIPOS[extensao(anexo.nome)]?.imagem && !baixar;
  // O arquivo nunca roda nada no nosso endereço, mesmo que o navegador tente interpretar.
  res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set("Cache-Control", "private, no-store");
  res.type(anexo.tipo);
  if (!imagem) res.attachment(anexo.nome);
  res.sendFile(path.basename(anexo.arquivo), { root: config.pastaAnexos, dotfiles: "deny" });
}

export const tamanhoLegivel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
