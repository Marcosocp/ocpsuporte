// Leitura de campos de formulário e do upload, com limites.
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { upload, MAX_ANEXOS, TAMANHO_MAXIMO } from "./anexos.js";

export const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function id(v: unknown): number | null {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Checkboxes/selects múltiplos chegam como string ou lista.
export const ids = (v: unknown): number[] =>
  [...new Set((Array.isArray(v) ? v : v === undefined ? [] : [v]).map(id).filter((n): n is number => n !== null))];

export const escolha = <T extends object>(opcoes: T, v: unknown): keyof T | null =>
  typeof v === "string" && Object.hasOwn(opcoes, v) ? (v as keyof T) : null;

/** Recebe o multipart (campo "anexos"); erro de tamanho/quantidade vira req.erroUpload em vez de 500. */
export function receberUpload(req: Request, res: Response, next: NextFunction) {
  upload.array("anexos", MAX_ANEXOS)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.locals.erroUpload = err.code === "LIMIT_FILE_SIZE"
        ? `Cada arquivo pode ter no máximo ${TAMANHO_MAXIMO / 1024 / 1024} MB.`
        : err.code === "LIMIT_FILE_COUNT" ? `Envie no máximo ${MAX_ANEXOS} arquivos por vez.` : "Não foi possível receber os arquivos.";
      req.body ??= {};
      return next();
    }
    next(err);
  });
}

export const arquivosRecebidos = (req: Request) => (Array.isArray(req.files) ? req.files : []);
