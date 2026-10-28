// Cloudflare Access: o painel pela internet só abre com o token (JWT) que o Access coloca em cada requisição
// (cabeçalho Cf-Access-Jwt-Assertion). Conferimos aqui a assinatura (RS256, chaves públicas da equipe no Access),
// o público (AUD da aplicação), o emissor e a validade — se o Access for mal configurado ou contornado, o painel
// continua fechado.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";

const b64url = (s: string) => Buffer.from(s, "base64url");

let chaves = new Map<string, KeyObject>();
let buscadoEm = 0;

async function carregarChaves(): Promise<void> {
  const { certsUrl, jwksArquivo } = config.cfAccess;
  // Instância de teste: chaves de um arquivo local, sem Cloudflare.
  const corpo = jwksArquivo
    ? JSON.parse(await readFile(jwksArquivo, "utf8"))
    : await (await fetch(certsUrl, { signal: AbortSignal.timeout(5000) })).json() as any;
  const novas = new Map<string, KeyObject>();
  for (const jwk of corpo.keys ?? []) {
    if (jwk.kty === "RSA" && jwk.kid) novas.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
  }
  chaves = novas;
  buscadoEm = Date.now();
}

// Chaves em cache por 1 h; "kid" desconhecido força nova busca (a Cloudflare troca as chaves periodicamente),
// no máximo uma vez por minuto.
async function chave(kid: string): Promise<KeyObject | null> {
  const idade = Date.now() - buscadoEm;
  if (idade > 60 * 60 * 1000 || (!chaves.has(kid) && idade > 60 * 1000)) {
    try {
      await carregarChaves();
    } catch (e) {
      console.error("Cloudflare Access: falha ao buscar as chaves:", (e as Error).message);
    }
  }
  return chaves.get(kid) ?? null;
}

/** E-mail da pessoa autenticada no Access, ou null se o token faltar ou não for válido. */
export async function emailDoAccess(token: string | undefined): Promise<string | null> {
  const { aud, emissor } = config.cfAccess;
  if (!aud || !emissor || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const cabecalho = JSON.parse(b64url(partes[0]).toString("utf8"));
    if (cabecalho.alg !== "RS256" || typeof cabecalho.kid !== "string") return null;
    const k = await chave(cabecalho.kid);
    if (!k || !verify("RSA-SHA256", Buffer.from(`${partes[0]}.${partes[1]}`), k, b64url(partes[2]))) return null;
    const dados = JSON.parse(b64url(partes[1]).toString("utf8"));
    const agora = Math.floor(Date.now() / 1000);
    const auds: unknown[] = Array.isArray(dados.aud) ? dados.aud : [dados.aud];
    if (!auds.includes(aud) || dados.iss !== emissor) return null;
    if (typeof dados.exp !== "number" || dados.exp < agora - 30) return null;
    if (typeof dados.nbf === "number" && dados.nbf > agora + 30) return null;
    return typeof dados.email === "string" && dados.email ? dados.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
