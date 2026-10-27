import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { config } from "./config.js";

// Chave derivada do SESSION_SECRET só para os códigos de login.
const CHAVE_CODIGO = createHmac("sha256", config.sessionSecret).update("ocpsuporte:codigo-login").digest();

export const novoCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function hashCodigo(usuarioId: number, codigo: string): string {
  return createHmac("sha256", CHAVE_CODIGO).update(`${usuarioId}:${codigo}`).digest("hex");
}

// Tokens longos (links de convite/senha, cookie de navegador confiável): aleatórios, guardados só como SHA-256.
export const novoToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const formatoToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
