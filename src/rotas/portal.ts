// Portal do cliente: abrir e acompanhar chamados; o gestor também cuida dos usuários e departamentos da empresa.
import { Router, type Request, type Response } from "express";
import { pool } from "../db/conexao.js";
import { conferirCsrf, exigirCliente, exigirGestor } from "../auth.js";
import { AnexoInvalido, servirAnexo, validarAnexos } from "../anexos.js";
import {
  ABERTAS, ENCERRADAS, IMPACTOS, RegraChamado, TIPOS, abrirChamado, buscarChamado, cancelar, confirmarSolucao, conversa,
  filtroVisibilidade, responderComoCliente,
} from "../chamados.js";
import {
  ErroCadastro, atualizarDepartamento, atualizarUsuarioCliente, criarDepartamento, criarUsuarioCliente, departamentosDoCliente,
  reenviarConvite, usuariosDoCliente,
} from "../cadastro.js";
import { arquivosRecebidos, escolha, id, receberUpload, texto } from "../formulario.js";

export const rotasPortal = Router();
rotasPortal.use(exigirCliente);

const ERROS_DE_USUARIO = [RegraChamado, ErroCadastro, AnexoInvalido];
const erroDeUsuario = (e: unknown): e is Error => ERROS_DE_USUARIO.some((C) => e instanceof C);

rotasPortal.get("/", async (req, res) => {
  const u = req.session.usuario!;
  const encerrados = req.query.ver === "encerrados";
  const f = filtroVisibilidade(u);
  const [chamados] = await pool.query<any[]>(
    `SELECT c.id, c.titulo, c.status, c.tipo, c.criado_em, c.atualizado_em, s.nome AS solicitante, d.nome AS departamento
     FROM chamados c JOIN usuarios s ON s.id = c.solicitante_id LEFT JOIN departamentos d ON d.id = c.departamento_id
     WHERE ${f.sql} AND c.status IN (?) ORDER BY c.atualizado_em DESC, c.id DESC LIMIT 300`,
    [...f.params, encerrados ? ENCERRADAS : ABERTAS],
  );
  res.render("portal/inicio", { chamados, encerrados });
});

// --- Abrir chamado ---

async function opcoesNovo(req: Request) {
  const u = req.session.usuario!;
  // O gestor abre por qualquer departamento; o usuário, pelos seus (ou sem departamento, se não tiver nenhum).
  const [departamentos] = u.papel === "gestor"
    ? await pool.query<any[]>("SELECT id, nome FROM departamentos WHERE cliente_id = ? AND ativo ORDER BY nome", [u.clienteId])
    : await pool.query<any[]>(
      `SELECT d.id, d.nome FROM departamentos d JOIN usuario_departamentos ud ON ud.departamento_id = d.id
       WHERE ud.usuario_id = ? AND d.ativo ORDER BY d.nome`,
      [u.id],
    );
  const [sistemas] = await pool.query<any[]>(
    "SELECT id, nome, acesso FROM sistemas WHERE cliente_id = ? AND ativo ORDER BY nome", [u.clienteId],
  );
  return { departamentos, sistemas };
}

const formularioVazio = { titulo: "", tipo: "", impacto: "pessoa", departamento_id: "", sistema_id: "", descricao: "" };

rotasPortal.get("/chamados/novo", async (req, res) => {
  res.render("portal/novo", { ...(await opcoesNovo(req)), valores: formularioVazio, erro: null });
});

rotasPortal.post("/chamados/novo", receberUpload, conferirCsrf, async (req, res) => {
  const u = req.session.usuario!;
  const opcoes = await opcoesNovo(req);
  const valores = { ...formularioVazio, ...req.body };
  const falhar = (erro: string) => res.status(400).render("portal/novo", { ...opcoes, valores, erro });
  if (res.locals.erroUpload) return falhar(res.locals.erroUpload);

  const titulo = texto(req.body.titulo, 200);
  const descricao = texto(req.body.descricao, 20000);
  const tipo = escolha(TIPOS, req.body.tipo);
  const impacto = escolha(IMPACTOS, req.body.impacto);
  if (!titulo || !descricao) return falhar("Preencha o assunto e a descrição.");
  if (!tipo || !impacto) return falhar("Escolha o tipo do chamado e o impacto.");

  // Departamento e sistema só entre os oferecidos a este usuário (nunca de outra empresa).
  const departamentoId = id(req.body.departamento_id);
  if (departamentoId && !opcoes.departamentos.some((d) => d.id === departamentoId)) return falhar("Departamento inválido.");
  if (!departamentoId && opcoes.departamentos.length) return falhar("Escolha o departamento.");
  const sistemaId = id(req.body.sistema_id);
  if (sistemaId && !opcoes.sistemas.some((s) => s.id === sistemaId)) return falhar("Sistema inválido.");

  const arquivos = arquivosRecebidos(req);
  try {
    validarAnexos(arquivos);
  } catch (e) {
    if (erroDeUsuario(e)) return falhar(e.message);
    throw e;
  }
  const chamadoId = await abrirChamado(req, {
    clienteId: u.clienteId!, solicitanteId: u.id, departamentoId, sistemaId, titulo, tipo, impacto, descricao, canal: "portal",
  }, arquivos);
  req.session.aviso = "Chamado aberto. Você vai receber as novidades por e-mail.";
  res.redirect(`/portal/chamados/${chamadoId}`);
});

// --- Chamado ---

async function chamadoOu404(req: Request, res: Response) {
  const ch = await buscarChamado(req.session.usuario!, Number(req.params.id));
  if (!ch) res.status(404).render("erro", { mensagem: "Chamado não encontrado." });
  return ch;
}

rotasPortal.get("/chamados/:id", async (req, res) => {
  const ch = await chamadoOu404(req, res);
  if (!ch) return;
  res.render("portal/chamado", { ch, mensagens: await conversa(ch.id, false), erro: null });
});

async function acao(req: Request, res: Response, fn: (ch: any) => Promise<void>, aviso: string) {
  const ch = await chamadoOu404(req, res);
  if (!ch) return;
  try {
    await fn(ch);
    req.session.aviso = aviso;
  } catch (e) {
    if (!erroDeUsuario(e)) throw e;
    req.session.aviso = e.message;
  }
  res.redirect(`/portal/chamados/${ch.id}`);
}

rotasPortal.post("/chamados/:id/responder", receberUpload, conferirCsrf, (req, res) => acao(req, res, async (ch) => {
  if (res.locals.erroUpload) throw new RegraChamado(res.locals.erroUpload);
  const mensagem = texto(req.body.texto, 20000);
  if (!mensagem) throw new RegraChamado("Escreva a mensagem.");
  const arquivos = arquivosRecebidos(req);
  validarAnexos(arquivos);
  await responderComoCliente(req, ch, mensagem, arquivos);
}, "Resposta enviada."));

rotasPortal.post("/chamados/:id/confirmar", (req, res) => acao(req, res, (ch) => confirmarSolucao(req, ch), "Obrigado! Chamado encerrado."));

rotasPortal.post("/chamados/:id/cancelar", (req, res) => acao(req, res, (ch) => cancelar(req, ch, texto(req.body.motivo, 500)), "Chamado cancelado."));

// Anexo: só de mensagem pública de chamado que este usuário pode ver.
rotasPortal.get("/anexos/:id", async (req, res) => {
  const f = filtroVisibilidade(req.session.usuario!);
  const [linhas] = await pool.query<any[]>(
    `SELECT a.* FROM anexos a JOIN mensagens m ON m.id = a.mensagem_id JOIN chamados c ON c.id = a.chamado_id
     WHERE a.id = ? AND m.visibilidade = 'publica' AND ${f.sql}`,
    [id(req.params.id), ...f.params],
  );
  if (!linhas[0]) return res.status(404).render("erro", { mensagem: "Arquivo não encontrado." });
  servirAnexo(res, linhas[0], req.query.baixar === "1");
});

// --- Equipe da empresa (gestor) ---

rotasPortal.get("/equipe", exigirGestor, async (req, res) => {
  const clienteId = req.session.usuario!.clienteId!;
  res.render("portal/equipe", {
    usuarios: await usuariosDoCliente(clienteId),
    departamentos: await departamentosDoCliente(clienteId),
  });
});

async function cadastro(req: Request, res: Response, fn: (clienteId: number) => Promise<string | void>, aviso: string) {
  try {
    req.session.aviso = (await fn(req.session.usuario!.clienteId!)) || aviso;
  } catch (e) {
    if (!erroDeUsuario(e)) throw e;
    req.session.aviso = e.message;
  }
  res.redirect("/portal/equipe");
}

rotasPortal.post("/equipe/usuarios", exigirGestor, (req, res) => cadastro(req, res, async (clienteId) => {
  const enviado = await criarUsuarioCliente(req, clienteId, req.body);
  if (!enviado) return "Usuário criado, mas o e-mail de convite falhou. Use “reenviar convite”.";
}, "Usuário criado. Ele recebeu um e-mail para definir a senha."));

rotasPortal.post("/equipe/usuarios/:id", exigirGestor, (req, res) =>
  cadastro(req, res, (clienteId) => atualizarUsuarioCliente(req, clienteId, Number(req.params.id), req.body), "Usuário atualizado."));

rotasPortal.post("/equipe/usuarios/:id/convite", exigirGestor, (req, res) =>
  cadastro(req, res, (clienteId) => reenviarConvite(req, clienteId, Number(req.params.id)), "Convite reenviado."));

rotasPortal.post("/equipe/departamentos", exigirGestor, (req, res) =>
  cadastro(req, res, (clienteId) => criarDepartamento(req, clienteId, req.body), "Departamento criado."));

rotasPortal.post("/equipe/departamentos/:id", exigirGestor, (req, res) =>
  cadastro(req, res, (clienteId) => atualizarDepartamento(req, clienteId, Number(req.params.id), req.body), "Departamento atualizado."));
