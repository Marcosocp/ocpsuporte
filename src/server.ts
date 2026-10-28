import path from "node:path";
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/conexao.js";
import { migrar } from "./db/migrar.js";
import { csrf, ehEquipe, inicioDe } from "./auth.js";
import { restringirPublico } from "./publico.js";
import { rotasConta } from "./rotas/conta.js";
import { rotasPortal } from "./rotas/portal.js";
import { rotasPainel } from "./rotas/painel.js";
import { rotasCadastros } from "./rotas/cadastros.js";
import { rotasAutocadastro } from "./rotas/autocadastro.js";
import { contarPendentes } from "./autocadastro.js";
import { IMPACTOS, PRIORIDADES, SITUACOES_CLIENTE, SITUACOES_EQUIPE, TIPOS, fecharResolvidosAntigos } from "./chamados.js";
import { numero } from "./modelos-email.js";
import { EXTENSOES_ACEITAS, MAX_ANEXOS, TAMANHO_MAXIMO, tamanhoLegivel } from "./anexos.js";
import { formatarCelular, formatarCnpj } from "./validacao.js";
import { concluirSemResposta, iniciarTriagem } from "./triagem.js";
import { carregarFeriados, recalcularAbertos, verificarPrazos } from "./prazos.js";
import { duracaoUtil } from "./expediente.js";
import { hhmm } from "./horas.js";

const aplicadas = await migrar();
if (aplicadas.length) console.log(`Migrações aplicadas: ${aplicadas.join(", ")}`);
await carregarFeriados();
await recalcularAbertos(); // prazos sempre coerentes com a tabela e os feriados atuais

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(config.raiz, "views"));
// Atrás de proxy (tailscale serve / cloudflared): necessário para req.ip real (auditoria/limite de tentativas).
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(restringirPublico); // primeiro de tudo: pela internet só passam login, conta, portal e estáticos

app.use(helmet({
  contentSecurityPolicy: { directives: { "script-src": ["'self'"], "img-src": ["'self'", "data:", "blob:"] } },
}));
// Sem cache longo: o navegador revalida (ETag) e nunca fica com JS/CSS antigo depois de uma atualização.
app.use("/static", express.static(path.join(config.raiz, "public"), { maxAge: 0 }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));

const MySQLStore = MySQLStoreFactory(session as any);
app.use(session({
  name: "ocpsuporte.sid",
  secret: config.sessionSecret,
  store: new MySQLStore({
    createDatabaseTable: true,
    schema: { tableName: "sessoes", columnNames: { session_id: "id", expires: "expira", data: "data" } },
  }, pool as any),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  // "auto": cookie Secure quando a requisição chegou por HTTPS (X-Forwarded-Proto do proxy).
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 8 * 60 * 60 * 1000 },
}));

// Muda a cada reinício: força o navegador a baixar CSS/JS novos depois de uma atualização.
const versao = Date.now().toString(36);
const fuso = { timeZone: "America/Sao_Paulo" } as const;
app.locals.dataHora = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { ...fuso, dateStyle: "short", timeStyle: "short" }) : "";
app.locals.data = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", fuso) : "");
app.locals.dataIso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
Object.assign(app.locals, {
  numero, tamanhoLegivel, duracaoUtil, hhmm, formatarCelular, formatarCnpj, TIPOS, IMPACTOS, PRIORIDADES, SITUACOES_CLIENTE, SITUACOES_EQUIPE,
  EXTENSOES_ACEITAS, MAX_ANEXOS, TAMANHO_MAXIMO_MB: TAMANHO_MAXIMO / 1024 / 1024,
});

app.use((req, res, next) => {
  res.locals.versao = versao;
  res.locals.usuario = req.session.usuario ?? null;
  res.locals.equipe = ehEquipe(req.session.usuario);
  res.locals.aviso = req.session.aviso ?? null;
  delete req.session.aviso;
  next();
});
// Administrador: quantos pedidos de acesso esperam aprovação (aparece no menu).
app.use(async (req, res, next) => {
  res.locals.pedidosPendentes = req.session.usuario?.papel === "admin" ? await contarPendentes() : 0;
  next();
});
app.use(csrf);

app.get("/saude", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});
app.get("/", (req, res) => res.redirect(req.session.usuario ? inicioDe(req.session.usuario) : "/login"));
app.use("/conta/cadastro", rotasAutocadastro);
app.use(rotasConta);
app.use("/portal", rotasPortal);
// Ordem importa: os cadastros exigem administrador para tudo que chega a eles,
// então o painel (chamados, que os analistas usam) vem antes.
app.use("/painel", rotasPainel);
app.use("/painel", rotasCadastros);

app.use((_req, res) => res.status(404).render("erro", { mensagem: "Página não encontrada." }));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).render("erro", { mensagem: "Erro interno. Tente de novo." });
});

app.listen(config.porta, () => console.log(`OCP Suporte ouvindo na porta ${config.porta}`));
await iniciarTriagem();

// Tarefas periódicas (a cada 10 minutos): triagens sem resposta do cliente seguem para a equipe,
// resolvidos sem retorno fecham e códigos/links vencidos são apagados.
async function tarefas() {
  const semResposta = await concluirSemResposta();
  if (semResposta) console.log(`Tarefas: ${semResposta} triagem(ns) sem resposta do cliente seguiram para a equipe`);
  const fechados = await fecharResolvidosAntigos(config.diasFecharResolvido);
  await pool.query("DELETE FROM codigos_login WHERE expira_em < UTC_TIMESTAMP() - INTERVAL 1 DAY");
  await pool.query("DELETE FROM navegadores_confiaveis WHERE expira_em < UTC_TIMESTAMP()");
  await pool.query("DELETE FROM links_conta WHERE expira_em < UTC_TIMESTAMP() - INTERVAL 30 DAY");
  if (fechados) console.log(`Tarefas: ${fechados} chamado(s) fechado(s) automaticamente`);
}
setInterval(() => tarefas().catch((e) => console.error("Falha nas tarefas periódicas:", e)), 10 * 60 * 1000).unref();

// Prazos: avisa antes de vencer e escala quando estoura (a cada 5 minutos).
const prazos = () => verificarPrazos()
  .then((n) => { if (n) console.log(`Prazos: ${n} aviso(s) enviado(s)`); })
  .catch((e) => console.error("Falha na verificação de prazos:", e));
setInterval(prazos, Number(process.env.PRAZOS_INTERVALO_S ?? 300) * 1000).unref();
prazos();
