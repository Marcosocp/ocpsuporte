// Login com verificação em duas etapas (código por e-mail), convite, esqueci a senha e troca de senha.
import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db/conexao.js";
import { conferirSenha, equipeBarrada, exigirLogin, HASH_FALSO, hashSenha, inicioDe, validarSenhaNova } from "../auth.js";
import { registrar } from "../auditoria.js";
import { enviarEmail } from "../email.js";
import { codigoLogin } from "../modelos-email.js";
import { derrubarAcessos, enviarRedefinicao } from "../contas.js";
import { formatoToken, hashCodigo, hashToken, novoCodigo, novoToken } from "../tokens.js";

export const rotasConta = Router();

const COOKIE_NAVEGADOR = "ocpsuporte.nav";
const DIAS_NAVEGADOR = 30;
const MAX_TENTATIVAS = 5;

const limite = (limit: number, minutos: number, view: string, porEmail = false) => rateLimit({
  windowMs: minutos * 60 * 1000,
  limit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  ...(porEmail ? { keyGenerator: (req: Request) => `${req.ip}|${String(req.body?.email ?? "").trim().toLowerCase()}` } : {}),
  handler: (_req, res) => res.status(429).render(view, { erro: `Muitas tentativas. Aguarde ${minutos} minutos.`, email: "", enviado: false }),
});
// Login: 10 tentativas por conta (por IP) e um teto folgado por IP — uma empresa inteira sai pelo mesmo IP.
const limiteLoginConta = limite(10, 15, "conta/login", true);
const limiteLoginIp = limite(100, 15, "conta/login");
const limiteCodigo = limite(15, 15, "conta/codigo");
const limiteEsqueci = limite(5, 15, "conta/esqueci");
// Definir senha pelo link: o token já é impossível de adivinhar; o limite só segura abuso.
// Folgado porque uma empresa inteira pode aceitar convites ao mesmo tempo, do mesmo IP.
const limiteDefinir = limite(30, 15, "erro");

function lerCookie(req: Request, nome: string): string | null {
  for (const parte of (req.get("cookie") ?? "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function usuarioPodeEntrar(id: number): Promise<any | null> {
  const [linhas] = await pool.query<any[]>(
    `SELECT u.*, c.ativo AS cliente_ativo FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id WHERE u.id = ?`,
    [id],
  );
  const u = linhas[0];
  return u && u.ativo && u.senha_hash && (u.cliente_id === null || u.cliente_ativo) ? u : null;
}

function concluirLogin(req: Request, res: Response, next: NextFunction, u: any, via: string) {
  const barrada = equipeBarrada(req, u);
  if (barrada) return res.status(403).render("conta/login", { erro: barrada, email: u.email });
  // Nova sessão a cada login (evita fixação de sessão).
  req.session.regenerate(async (err) => {
    if (err) return next(err);
    req.session.usuario = { id: u.id, nome: u.nome, email: u.email, papel: u.papel, clienteId: u.cliente_id };
    try {
      await pool.query("UPDATE usuarios SET ultimo_login = UTC_TIMESTAMP() WHERE id = ?", [u.id]);
      await registrar(req, "login", { via }, u.id);
      res.redirect(inicioDe(req.session.usuario));
    } catch (e) {
      next(e);
    }
  });
}

// Envia um código novo. Não envia se já saiu um há menos de 1 minuto e ainda está valendo
// (o e-mail pode estar chegando), nem passa de 10 por hora.
async function enviarCodigo(u: { id: number; nome: string; email: string }): Promise<boolean> {
  const [recentes] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n,
       SUM(criado_em > UTC_TIMESTAMP() - INTERVAL 1 MINUTE AND usado_em IS NULL AND tentativas < ?) AS valendo
     FROM codigos_login WHERE usuario_id = ? AND criado_em > UTC_TIMESTAMP() - INTERVAL 1 HOUR`,
    [MAX_TENTATIVAS, u.id],
  );
  if (recentes[0].n >= 10 || Number(recentes[0].valendo) > 0) return false;
  const codigo = novoCodigo();
  await pool.query(
    "INSERT INTO codigos_login (usuario_id, codigo_hash, expira_em) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)",
    [u.id, hashCodigo(u.id, codigo)],
  );
  await enviarEmail(codigoLogin(u, codigo));
  return true;
}

const mascarar = (email: string) => email.replace(/^(.{2})[^@]*(@.*)$/, "$1•••$2");

rotasConta.get("/login", (req, res) => {
  if (req.session.usuario) return res.redirect(inicioDe(req.session.usuario));
  res.render("conta/login", { erro: null, email: "" });
});

rotasConta.post("/login", limiteLoginIp, limiteLoginConta, async (req, res, next) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const senha = String(req.body.senha ?? "");
  const [linhas] = await pool.query<any[]>("SELECT id, senha_hash FROM usuarios WHERE email = ?", [email]);
  const senhaOk = await conferirSenha(linhas[0]?.senha_hash ?? HASH_FALSO, senha);
  const u = senhaOk ? await usuarioPodeEntrar(linhas[0].id) : null;

  if (!u) {
    await registrar(req, "login_falhou", { email }, linhas[0]?.id ?? null);
    return res.status(401).render("conta/login", { erro: "E-mail ou senha incorretos.", email });
  }
  // Equipe pelo endereço público: nem manda código (o painel não abre por aqui).
  const barrada = equipeBarrada(req, u);
  if (barrada) {
    await registrar(req, "login_equipe_barrado", { email_access: req.emailAccess ?? null }, u.id);
    return res.status(403).render("conta/login", { erro: barrada, email });
  }

  // Navegador marcado como confiável dispensa o código.
  const cookie = lerCookie(req, COOKIE_NAVEGADOR);
  if (formatoToken(cookie)) {
    const [nav] = await pool.query<any[]>(
      "SELECT id FROM navegadores_confiaveis WHERE token_hash = ? AND usuario_id = ? AND expira_em > UTC_TIMESTAMP()",
      [hashToken(cookie), u.id],
    );
    if (nav.length) return concluirLogin(req, res, next, u, "navegador_confiavel");
  }

  req.session.loginPendente = { usuarioId: u.id, desde: Date.now() };
  if (!(await enviarCodigo(u))) {
    // Código recente ainda valendo (segue com ele) ou limite por hora atingido.
    await registrar(req, "codigo_login_limite", {}, u.id);
    req.session.aviso = "Use o último código enviado. Se não chegou, aguarde um minuto e peça outro.";
  }
  res.redirect("/login/codigo");
});

function pendente(req: Request): number | null {
  const p = req.session.loginPendente;
  return p && Date.now() - p.desde < 15 * 60 * 1000 ? p.usuarioId : null;
}

rotasConta.get("/login/codigo", async (req, res) => {
  const id = pendente(req);
  if (!id) return res.redirect("/login");
  const [linhas] = await pool.query<any[]>("SELECT email FROM usuarios WHERE id = ?", [id]);
  res.render("conta/codigo", { erro: null, email: mascarar(linhas[0].email) });
});

rotasConta.post("/login/codigo", limiteCodigo, async (req, res, next) => {
  const id = pendente(req);
  if (!id) return res.redirect("/login");
  const u = await usuarioPodeEntrar(id);
  if (!u) return res.redirect("/login");
  const codigo = String(req.body.codigo ?? "").replace(/\D/g, "");
  const tela = (erro: string) => res.status(400).render("conta/codigo", { erro, email: mascarar(u.email) });

  const [linhas] = await pool.query<any[]>(
    "SELECT * FROM codigos_login WHERE usuario_id = ? AND usado_em IS NULL AND expira_em > UTC_TIMESTAMP() ORDER BY id DESC LIMIT 1",
    [id],
  );
  const registro = linhas[0];
  if (!registro || registro.tentativas >= MAX_TENTATIVAS) return tela("Código expirado. Peça um novo código.");

  const esperado = Buffer.from(registro.codigo_hash);
  const recebido = Buffer.from(hashCodigo(id, codigo));
  if (codigo.length !== 6 || !timingSafeEqual(esperado, recebido)) {
    await pool.query("UPDATE codigos_login SET tentativas = tentativas + 1 WHERE id = ?", [registro.id]);
    await registrar(req, "codigo_login_errado", {}, id);
    return tela(registro.tentativas + 1 >= MAX_TENTATIVAS ? "Código bloqueado por excesso de tentativas. Peça um novo código." : "Código incorreto.");
  }
  await pool.query("UPDATE codigos_login SET usado_em = UTC_TIMESTAMP() WHERE id = ?", [registro.id]);

  if (req.body.confiar === "1") {
    const token = novoToken();
    await pool.query(
      "INSERT INTO navegadores_confiaveis (usuario_id, token_hash, user_agent, expira_em) VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? DAY)",
      [id, hashToken(token), (req.get("user-agent") ?? "").slice(0, 500), DIAS_NAVEGADOR],
    );
    res.cookie(COOKIE_NAVEGADOR, token, {
      httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: DIAS_NAVEGADOR * 24 * 60 * 60 * 1000,
    });
  }
  concluirLogin(req, res, next, u, "codigo");
});

rotasConta.post("/login/codigo/reenviar", limiteCodigo, async (req, res) => {
  const id = pendente(req);
  if (!id) return res.redirect("/login");
  const u = await usuarioPodeEntrar(id);
  if (!u) return res.redirect("/login");
  req.session.aviso = (await enviarCodigo(u))
    ? "Enviamos um novo código."
    : "Aguarde um minuto para pedir outro código (máximo de 10 por hora).";
  res.redirect("/login/codigo");
});

rotasConta.post("/logout", async (req, res) => {
  if (req.session.usuario) await registrar(req, "logout");
  req.session.destroy(() => res.redirect("/login"));
});

// --- Esqueci a senha ---

rotasConta.get("/conta/esqueci", (_req, res) => res.render("conta/esqueci", { erro: null, enviado: false }));

rotasConta.post("/conta/esqueci", limiteEsqueci, async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const [linhas] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ? AND ativo", [email]);
  // Mesma resposta exista ou não o e-mail (não revela quem tem cadastro).
  if (linhas[0] && (await usuarioPodeEntrar(linhas[0].id))) {
    await enviarRedefinicao(linhas[0].id);
    await registrar(req, "senha_esqueci", {}, linhas[0].id);
  }
  res.render("conta/esqueci", { erro: null, enviado: true });
});

// --- Definir senha (convite ou redefinição) ---

async function lerLink(token: unknown) {
  if (!formatoToken(token)) return null;
  const [linhas] = await pool.query<any[]>(
    `SELECT l.id, l.tipo, l.usuario_id, u.nome, u.email, u.ativo FROM links_conta l JOIN usuarios u ON u.id = l.usuario_id
     WHERE l.token_hash = ? AND l.usado_em IS NULL AND l.expira_em > UTC_TIMESTAMP()`,
    [hashToken(token)],
  );
  return linhas[0]?.ativo ? linhas[0] : null;
}

const linkInvalido = "Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.";

rotasConta.get("/conta/definir/:token", async (req, res) => {
  const link = await lerLink(req.params.token);
  if (!link) return res.status(404).render("erro", { mensagem: linkInvalido });
  res.render("conta/definir", { erro: null, link });
});

rotasConta.post("/conta/definir/:token", limiteDefinir, async (req, res) => {
  const link = await lerLink(req.params.token);
  if (!link) return res.status(404).render("erro", { mensagem: linkInvalido });
  const nova = String(req.body.nova ?? "");
  const problema = validarSenhaNova(nova) ?? (nova !== req.body.confirmar ? "A confirmação não confere." : null);
  if (problema) return res.status(400).render("conta/definir", { erro: problema, link });

  await pool.query("UPDATE usuarios SET senha_hash = ? WHERE id = ?", [await hashSenha(nova), link.usuario_id]);
  await pool.query("UPDATE links_conta SET usado_em = UTC_TIMESTAMP() WHERE usuario_id = ? AND usado_em IS NULL", [link.usuario_id]);
  await derrubarAcessos([link.usuario_id]);
  await registrar(req, link.tipo === "convite" ? "convite_aceito" : "senha_redefinida", {}, link.usuario_id);
  req.session.aviso = "Senha definida. Entre com seu e-mail e a nova senha.";
  res.redirect("/login");
});

// --- Trocar a própria senha ---

rotasConta.get("/conta/senha", exigirLogin, (_req, res) => res.render("conta/senha", { erro: null }));

rotasConta.post("/conta/senha", exigirLogin, async (req, res) => {
  const usuario = req.session.usuario!;
  const atual = String(req.body.atual ?? "");
  const nova = String(req.body.nova ?? "");
  const [linhas] = await pool.query<any[]>("SELECT senha_hash FROM usuarios WHERE id = ?", [usuario.id]);

  if (!(await conferirSenha(linhas[0].senha_hash, atual))) {
    return res.status(400).render("conta/senha", { erro: "Senha atual incorreta." });
  }
  const problema = validarSenhaNova(nova) ?? (nova !== req.body.confirmar ? "A confirmação não confere." : null)
    ?? (nova === atual ? "A nova senha deve ser diferente da atual." : null);
  if (problema) return res.status(400).render("conta/senha", { erro: problema });

  await pool.query("UPDATE usuarios SET senha_hash = ? WHERE id = ?", [await hashSenha(nova), usuario.id]);
  // Outros navegadores confiáveis deixam de dispensar o código (esta sessão continua).
  await pool.query("DELETE FROM navegadores_confiaveis WHERE usuario_id = ?", [usuario.id]);
  await registrar(req, "senha_alterada");
  req.session.aviso = "Senha alterada.";
  res.redirect(inicioDe(usuario));
});
