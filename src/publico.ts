// O que é acessível pela internet (Cloudflare Tunnel): login, conta, portal do cliente e estáticos.
// O painel da OCP fica fora da internet até a Fase 4 (Cloudflare Access); hoje, só pelo Tailscale.
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

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

export function restringirPublico(req: Request, res: Response, next: NextFunction) {
  if (!veioDaInternet(req)) return next();
  if (CAMINHOS_PUBLICOS.some((r) => r.test(req.path))) return next();
  // Resposta simples: roda antes da sessão, então as views (que usam usuário/CSRF) ainda não têm contexto.
  res.status(404).type("text/plain; charset=utf-8").send("Página não encontrada.");
}
