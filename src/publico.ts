// O que é acessível pela internet (Cloudflare Tunnel): login, conta, portal do cliente e estáticos.
// O painel da OCP só abre pela internet com o token válido do Cloudflare Access (src/cfaccess.ts); pelo Tailscale,
// sempre.
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { emailDoAccess } from "./cfaccess.js";

declare global {
  namespace Express {
    interface Request {
      // Pode usar o painel por este caminho: Tailscale/local, ou internet com Cloudflare Access válido.
      acessoEquipe?: boolean;
      // E-mail autenticado no Cloudflare Access (só quando veio por ele).
      emailAccess?: string | null;
    }
  }
}

const CAMINHOS_PUBLICOS = [
  /^\/$/, /^\/login(\/|$)/, /^\/logout$/, /^\/conta(\/|$)/, /^\/portal(\/|$)/, /^\/static\//, /^\/saude$/,
];

// Requisição veio pela internet? Pela rede Docker do túnel (src = cloudflared) ou pelo nome público.
export function veioDaInternet(req: Request): boolean {
  const origem = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const prefixo = config.redePublicaPrefixo;
  const pelaRedeDoTunel = prefixo !== "" && origem.startsWith(prefixo) && origem !== `${prefixo}1`;
  return pelaRedeDoTunel || (config.hostPublico !== "" && req.hostname === config.hostPublico);
}

export async function restringirPublico(req: Request, res: Response, next: NextFunction) {
  if (!veioDaInternet(req)) {
    req.acessoEquipe = true;
    return next();
  }
  req.emailAccess = await emailDoAccess(req.get("cf-access-jwt-assertion"));
  req.acessoEquipe = req.emailAccess !== null;
  if (req.acessoEquipe || CAMINHOS_PUBLICOS.some((r) => r.test(req.path))) return next();
  // Resposta simples: roda antes da sessão, então as views (que usam usuário/CSRF) ainda não têm contexto.
  res.status(404).type("text/plain; charset=utf-8").send("Página não encontrada.");
}
