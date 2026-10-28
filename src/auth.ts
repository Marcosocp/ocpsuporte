import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { hash, verify } from "@node-rs/argon2";
import { config } from "./config.js";

export type Papel = "admin" | "analista" | "gestor" | "usuario";

export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  clienteId: number | null; // null = equipe da OCP
}

declare module "express-session" {
  interface SessionData {
    usuario?: UsuarioSessao;
    csrf?: string;
    aviso?: string;
    // Senha conferida, aguardando o código da verificação em duas etapas.
    loginPendente?: { usuarioId: number; desde: number };
  }
}

export const ehEquipe = (u: UsuarioSessao | undefined) => u?.papel === "admin" || u?.papel === "analista";
export const inicioDe = (u: UsuarioSessao) => (ehEquipe(u) ? "/painel" : "/portal");

export const hashSenha = (senha: string) => hash(senha);
export const conferirSenha = (senhaHash: string, senha: string) => verify(senhaHash, senha);

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe (evita descobrir e-mails cadastrados pelo tempo de resposta).
export const HASH_FALSO = await hash(randomBytes(16).toString("hex"));

export function validarSenhaNova(senha: string): string | null {
  if (senha.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return "Use letras e números.";
  return null;
}

export function exigirLogin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.usuario) return res.redirect("/login");
  next();
}

/**
 * Equipe só entra por onde o painel é permitido (Tailscale, ou Cloudflare Access com o MESMO e-mail do usuário).
 * Devolve a mensagem de recusa, ou null se pode.
 */
export function equipeBarrada(req: Request, u: { papel: string; email: string }): string | null {
  if (!ehEquipe(u as UsuarioSessao)) return null;
  if (!req.acessoEquipe) return `A equipe da OCP entra pelo endereço do painel: ${config.painelUrl}`;
  if (req.emailAccess && req.emailAccess !== u.email.toLowerCase()) {
    return `Você passou pelo Cloudflare Access como ${req.emailAccess}, mas este usuário é ${u.email}. Use o mesmo e-mail nos dois.`;
  }
  return null;
}

// Painel: só a equipe da OCP. Cliente que cair aqui volta para o portal.
export function exigirEquipe(req: Request, res: Response, next: NextFunction) {
  if (!req.session.usuario) return res.redirect("/login");
  if (!ehEquipe(req.session.usuario)) return res.redirect("/portal");
  const barrada = equipeBarrada(req, req.session.usuario);
  if (barrada) return res.status(403).render("erro", { mensagem: barrada });
  next();
}

export function exigirAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.usuario?.papel !== "admin") return res.status(403).render("erro", { mensagem: "Acesso restrito ao administrador." });
  next();
}

// Portal: só usuários de cliente. A equipe da OCP vai para o painel.
export function exigirCliente(req: Request, res: Response, next: NextFunction) {
  if (!req.session.usuario) return res.redirect("/login");
  if (ehEquipe(req.session.usuario)) return res.redirect("/painel");
  next();
}

export function exigirGestor(req: Request, res: Response, next: NextFunction) {
  if (req.session.usuario?.papel !== "gestor") return res.status(403).render("erro", { mensagem: "Acesso restrito ao gestor da empresa." });
  next();
}

// Rotas com upload (multipart): o corpo só existe depois do multer, então o token é conferido
// na própria rota com conferirCsrf(). Qualquer outra rota multipart é recusada.
const ROTAS_MULTIPART = [
  /^\/portal\/chamados\/novo$/,
  /^\/portal\/chamados\/\d+\/responder$/,
  /^\/painel\/chamados\/novo$/,
  /^\/painel\/chamados\/\d+\/responder$/,
];

function tokenConfere(req: Request): boolean {
  const enviado = Buffer.from(String(req.get("x-csrf-token") ?? req.body?._csrf ?? ""));
  const esperado = Buffer.from(req.session.csrf ?? "");
  return esperado.length > 0 && enviado.length === esperado.length && timingSafeEqual(enviado, esperado);
}

function recusarCsrf(res: Response) {
  const mensagem = "Formulário expirado. Recarregue a página e tente de novo.";
  if (res.req.is("application/json")) return res.status(403).json({ erro: mensagem });
  return res.status(403).render("erro", { mensagem });
}

// CSRF: token por sessão, conferido em todo POST (campo _csrf do formulário ou cabeçalho x-csrf-token).
export function csrf(req: Request, res: Response, next: NextFunction) {
  req.session.csrf ??= randomBytes(32).toString("hex");
  res.locals.csrf = req.session.csrf;
  if (req.method === "POST") {
    if (req.is("multipart/form-data")) {
      if (!ROTAS_MULTIPART.some((r) => r.test(req.path))) return recusarCsrf(res);
    } else if (!tokenConfere(req)) {
      return recusarCsrf(res);
    }
  }
  next();
}

export function conferirCsrf(req: Request, res: Response, next: NextFunction) {
  if (!tokenConfere(req)) return recusarCsrf(res);
  next();
}
