// Painel da OCP: fila de chamados, atendimento e distribuição.
import { Router, type Request, type Response } from "express";
import { pool } from "../db/conexao.js";
import { conferirCsrf, exigirAdmin, exigirEquipe } from "../auth.js";
import { AnexoInvalido, servirAnexo, validarAnexos } from "../anexos.js";
import {
  ABERTAS, ENCERRADAS, IMPACTOS, RegraChamado, TIPOS, abrirChamado, assumir, buscarChamado, cancelar, conversa,
  distribuir, filtroVisibilidade, historico, reabrir, responderComoEquipe,
} from "../chamados.js";
import { arquivosRecebidos, escolha, id, receberUpload, texto } from "../formulario.js";
import { buscarTriagem, concluirAgora, enfileirar } from "../triagem.js";
import { situacaoPrazos } from "../prazos.js";
import { ErroHoras, doChamado, lancar, remover } from "../horas.js";
import { dataLocal } from "../expediente.js";

export const rotasPainel = Router();
rotasPainel.use(exigirEquipe);

const erroDeUsuario = (e: unknown): e is Error => e instanceof RegraChamado || e instanceof AnexoInvalido || e instanceof ErroHoras;

// Filas do painel. "distribuir" = sem responsável (para o analista: os da área dele).
const FILAS = {
  distribuir: { titulo: "Sem responsável", sql: "c.responsavel_id IS NULL AND c.status IN (?)", valores: [ABERTAS] },
  meus: { titulo: "Meus", sql: "c.responsavel_id = ? AND c.status IN (?)", valores: ["EU", ABERTAS] },
  abertos: { titulo: "Todos abertos", sql: "c.status IN (?)", valores: [ABERTAS] },
  atrasados: {
    titulo: "Prazo estourado",
    sql: `c.status IN ('novo', 'atribuido', 'em_atendimento') AND ((c.primeira_resposta_em IS NULL AND c.prazo_resposta_em < UTC_TIMESTAMP())
          OR (c.resolvido_em IS NULL AND c.prazo_solucao_em < UTC_TIMESTAMP()))`,
    valores: [],
  },
  aguardando: { titulo: "Aguardando cliente", sql: "c.status IN ('aguardando_cliente', 'resolvido')", valores: [] },
  encerrados: { titulo: "Encerrados", sql: "c.status IN (?)", valores: [ENCERRADAS] },
} as const;
type Fila = keyof typeof FILAS;

const ORDEM_PRIORIDADE = "FIELD(c.prioridade, 'critica', 'alta', 'normal', 'baixa')";
// Filas abertas: primeiro o que vence antes (1ª resposta pendente, senão solução); pausados e em triagem no fim.
const ORDEM_PRAZO = `CASE WHEN c.status IN ('aguardando_cliente', 'resolvido', 'triagem') OR c.prazo_resposta_em IS NULL THEN 1 ELSE 0 END,
  CASE WHEN c.primeira_resposta_em IS NULL THEN c.prazo_resposta_em ELSE c.prazo_solucao_em END, ${ORDEM_PRIORIDADE}, c.criado_em`;

rotasPainel.get("/", async (req, res) => {
  const u = req.session.usuario!;
  const padrao: Fila = u.papel === "admin" ? "distribuir" : "meus";
  const fila = (escolha(FILAS, req.query.fila) ?? padrao) as Fila;
  const clienteId = id(req.query.cliente);
  const visivel = filtroVisibilidade(u);
  const valores = (f: Fila) => FILAS[f].valores.map((v) => (v === "EU" ? u.id : v));

  const contagens: Record<string, number> = {};
  for (const f of Object.keys(FILAS) as Fila[]) {
    if (f === "encerrados") continue;
    const [r] = await pool.query<any[]>(
      `SELECT COUNT(*) AS n FROM chamados c WHERE ${visivel.sql} AND ${FILAS[f].sql}`, [...visivel.params, ...valores(f)],
    );
    contagens[f] = r[0].n;
  }

  const [chamados] = await pool.query<any[]>(
    `SELECT c.id, c.titulo, c.status, c.tipo, c.prioridade, c.criado_em, c.atualizado_em, c.sla_inicio_em, c.prazo_resposta_em,
            c.prazo_solucao_em, c.primeira_resposta_em, c.resolvido_em,
            cl.nome AS cliente, s.nome AS solicitante, a.nome AS area, r.nome AS responsavel,
            t.estado AS triagem, JSON_UNQUOTE(JSON_EXTRACT(t.ficha, '$.resumo')) AS resumo,
            IF(t.sugestao_aplicada_em IS NULL AND t.estado = 'concluida', t.sugestao_prioridade, NULL) AS sugestao_prioridade,
            IF(t.sugestao_aplicada_em IS NULL AND t.estado = 'concluida', su.nome, NULL) AS sugestao_responsavel
     FROM chamados c JOIN clientes cl ON cl.id = c.cliente_id JOIN usuarios s ON s.id = c.solicitante_id
     LEFT JOIN areas a ON a.id = c.area_id LEFT JOIN usuarios r ON r.id = c.responsavel_id
     LEFT JOIN triagens t ON t.chamado_id = c.id LEFT JOIN usuarios su ON su.id = t.sugestao_responsavel_id
     WHERE ${visivel.sql} AND ${FILAS[fila].sql} ${clienteId ? "AND c.cliente_id = ?" : ""}
     ORDER BY ${fila === "encerrados" ? "c.atualizado_em DESC" : ORDEM_PRAZO} LIMIT 300`,
    [...visivel.params, ...valores(fila), ...(clienteId ? [clienteId] : [])],
  );
  const [clientes] = await pool.query<any[]>("SELECT id, nome FROM clientes WHERE ativo ORDER BY nome");
  const agora = new Date();
  for (const c of chamados) c.prazos = situacaoPrazos(c, agora);
  res.render("painel/fila", { chamados, fila, filas: FILAS, contagens, clientes, clienteId });
});

// --- Abrir chamado em nome do cliente (ex.: pedido por telefone) ---

async function opcoesNovo(solicitanteId: number | null) {
  const [solicitantes] = await pool.query<any[]>(
    `SELECT u.id, u.nome, u.email, c.nome AS cliente, u.cliente_id FROM usuarios u JOIN clientes c ON c.id = u.cliente_id
     WHERE u.ativo AND c.ativo ORDER BY c.nome, u.nome`,
  );
  const solicitante = solicitantes.find((s) => s.id === solicitanteId) ?? null;
  if (!solicitante) return { solicitantes, solicitante, departamentos: [], sistemas: [] };
  const [departamentos] = await pool.query<any[]>(
    `SELECT d.id, d.nome, EXISTS (SELECT 1 FROM usuario_departamentos ud WHERE ud.departamento_id = d.id AND ud.usuario_id = ?) AS dele
     FROM departamentos d WHERE d.cliente_id = ? AND d.ativo ORDER BY dele DESC, d.nome`,
    [solicitante.id, solicitante.cliente_id],
  );
  const [sistemas] = await pool.query<any[]>("SELECT id, nome, acesso FROM sistemas WHERE cliente_id = ? AND ativo ORDER BY nome", [solicitante.cliente_id]);
  return { solicitantes, solicitante, departamentos, sistemas };
}

const formularioVazio = { titulo: "", tipo: "", impacto: "pessoa", departamento_id: "", sistema_id: "", descricao: "" };

rotasPainel.get("/chamados/novo", async (req, res) => {
  res.render("painel/novo", { ...(await opcoesNovo(id(req.query.solicitante))), valores: formularioVazio, erro: null });
});

rotasPainel.post("/chamados/novo", receberUpload, conferirCsrf, async (req, res) => {
  const opcoes = await opcoesNovo(id(req.body.solicitante_id));
  const valores = { ...formularioVazio, ...req.body };
  const falhar = (erro: string) => res.status(400).render("painel/novo", { ...opcoes, valores, erro });
  if (res.locals.erroUpload) return falhar(res.locals.erroUpload);
  if (!opcoes.solicitante) return falhar("Escolha o solicitante.");

  const titulo = texto(req.body.titulo, 200);
  const descricao = texto(req.body.descricao, 20000);
  const tipo = escolha(TIPOS, req.body.tipo);
  const impacto = escolha(IMPACTOS, req.body.impacto);
  if (!titulo || !descricao || !tipo || !impacto) return falhar("Preencha assunto, tipo, impacto e descrição.");
  const departamentoId = id(req.body.departamento_id);
  if (departamentoId && !opcoes.departamentos.some((d) => d.id === departamentoId)) return falhar("Departamento inválido.");
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
    clienteId: opcoes.solicitante.cliente_id, solicitanteId: opcoes.solicitante.id, departamentoId, sistemaId,
    titulo, tipo, impacto, descricao, canal: "painel",
  }, arquivos);
  req.session.aviso = "Chamado aberto. O solicitante recebeu a confirmação por e-mail.";
  res.redirect(`/painel/chamados/${chamadoId}`);
});

// --- Chamado ---

async function chamadoOu404(req: Request, res: Response) {
  const ch = await buscarChamado(req.session.usuario!, Number(req.params.id));
  if (!ch) res.status(404).render("erro", { mensagem: "Chamado não encontrado (ou fora da sua área)." });
  return ch;
}

rotasPainel.get("/chamados/:id", async (req, res) => {
  const ch = await chamadoOu404(req, res);
  if (!ch) return;
  const [areas] = await pool.query<any[]>("SELECT id, nome FROM areas WHERE ativo ORDER BY nome");
  const [equipe] = await pool.query<any[]>(
    `SELECT u.id, u.nome, GROUP_CONCAT(a.nome ORDER BY a.nome SEPARATOR ', ') AS areas
     FROM usuarios u LEFT JOIN analista_areas aa ON aa.usuario_id = u.id LEFT JOIN areas a ON a.id = aa.area_id
     WHERE u.ativo AND u.papel IN ('admin', 'analista') GROUP BY u.id ORDER BY u.nome`,
  );
  const f = filtroVisibilidade(req.session.usuario!);
  const [outros] = await pool.query<any[]>(
    `SELECT c.id, c.titulo, c.status, c.criado_em FROM chamados c WHERE c.solicitante_id = ? AND c.id <> ? AND ${f.sql}
     ORDER BY c.id DESC LIMIT 5`,
    [ch.solicitante_id, ch.id, ...f.params],
  );
  // Ficha da triagem: os chamados parecidos aparecem só se quem olha também pode vê-los.
  const triagem = await buscarTriagem(ch.id);
  let parecidos: any[] = [];
  if (triagem?.ficha?.parecidos?.length) {
    [parecidos] = await pool.query<any[]>(
      `SELECT c.id, c.titulo, cl.nome AS cliente FROM chamados c JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id IN (?) AND ${f.sql}`,
      [triagem.ficha.parecidos, ...f.params],
    );
  }
  res.render("painel/chamado", {
    ch, mensagens: await conversa(ch.id, true), eventos: await historico(ch.id), areas, equipe, outros, triagem, parecidos,
    prazos: situacaoPrazos(ch), horas: await doChamado(ch.id), hoje: dataLocal(new Date()),
  });
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
  res.redirect(`/painel/chamados/${ch.id}`);
}

rotasPainel.post("/chamados/:id/responder", receberUpload, conferirCsrf, (req, res) => acao(req, res, async (ch) => {
  if (res.locals.erroUpload) throw new RegraChamado(res.locals.erroUpload);
  const mensagem = texto(req.body.texto, 20000);
  if (!mensagem) throw new RegraChamado("Escreva a mensagem.");
  const arquivos = arquivosRecebidos(req);
  validarAnexos(arquivos);
  await responderComoEquipe(req, ch, mensagem, req.body.visibilidade === "interna", String(req.body.status ?? ""), arquivos);
}, req.body?.visibilidade === "interna" ? "Nota interna registrada." : "Resposta enviada ao cliente."));

rotasPainel.post("/chamados/:id/distribuir", exigirAdmin, (req, res) => acao(req, res, (ch) => distribuir(req, ch, {
  areaId: id(req.body.area_id),
  responsavelId: id(req.body.responsavel_id),
  prioridade: String(req.body.prioridade ?? ""),
  tipo: String(req.body.tipo ?? ""),
}), "Distribuição salva."));

// Aceitar a sugestão da triagem = distribuir com os valores sugeridos (sugestão vazia mantém o atual).
rotasPainel.post("/chamados/:id/aplicar-sugestao", exigirAdmin, (req, res) => acao(req, res, async (ch) => {
  const t = await buscarTriagem(ch.id);
  if (!t?.ficha || t.estado !== "concluida") throw new RegraChamado("Não há sugestão da triagem para este chamado.");
  await distribuir(req, ch, {
    areaId: t.sugestao_area_id ?? ch.area_id,
    responsavelId: t.sugestao_responsavel_id ?? ch.responsavel_id,
    prioridade: t.sugestao_prioridade ?? ch.prioridade,
    tipo: t.sugestao_tipo ?? ch.tipo,
  });
  await pool.query("UPDATE triagens SET sugestao_aplicada_em = UTC_TIMESTAMP() WHERE chamado_id = ?", [ch.id]);
}, "Sugestão aplicada."));

// Encerra as perguntas ao cliente e gera a ficha com o que já há.
rotasPainel.post("/chamados/:id/triagem/concluir", exigirAdmin, (req, res) => acao(req, res, async (ch) => {
  if (ch.status !== "triagem" || !(await concluirAgora(ch.id))) throw new RegraChamado("O chamado não está em triagem.");
}, "Triagem encerrada: a ficha será gerada com o que o cliente já informou."));

// Gera a ficha de novo (ex.: depois de mais conversa), sem falar com o cliente nem mudar o chamado.
rotasPainel.post("/chamados/:id/triagem/refazer", exigirAdmin, (req, res) => acao(req, res, async (ch) => {
  if (ENCERRADAS.includes(ch.status)) throw new RegraChamado("Chamado encerrado.");
  await enfileirar(ch.id, true);
}, "Ficha na fila do assistente. Recarregue em alguns segundos."));

// Horas trabalhadas (o cliente nunca vê).
rotasPainel.post("/chamados/:id/horas", (req, res) => acao(req, res, (ch) => lancar(req, ch, req.body), "Horas lançadas."));

rotasPainel.post("/chamados/:id/horas/:ap/remover", (req, res) =>
  acao(req, res, (ch) => remover(req, ch, Number(req.params.ap)), "Lançamento removido."));

rotasPainel.post("/chamados/:id/assumir", (req, res) => acao(req, res, (ch) => assumir(req, ch), "Chamado assumido."));

rotasPainel.post("/chamados/:id/cancelar", exigirAdmin, (req, res) =>
  acao(req, res, (ch) => cancelar(req, ch, texto(req.body.motivo, 500)), "Chamado cancelado."));

rotasPainel.post("/chamados/:id/reabrir", exigirAdmin, (req, res) => acao(req, res, (ch) => reabrir(req, ch), "Chamado reaberto."));

rotasPainel.get("/anexos/:id", async (req, res) => {
  const f = filtroVisibilidade(req.session.usuario!);
  const [linhas] = await pool.query<any[]>(
    `SELECT a.* FROM anexos a JOIN chamados c ON c.id = a.chamado_id WHERE a.id = ? AND ${f.sql}`, [id(req.params.id), ...f.params],
  );
  if (!linhas[0]) return res.status(404).render("erro", { mensagem: "Arquivo não encontrado." });
  servirAnexo(res, linhas[0], req.query.baixar === "1");
});

