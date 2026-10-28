// Regras dos chamados, usadas pelo portal do cliente e pelo painel da OCP:
// quem vê o quê, abertura, respostas, mudanças de situação e avisos por e-mail.
import type { Request } from "express";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "./db/conexao.js";
import type { UsuarioSessao } from "./auth.js";
import { registrar } from "./auditoria.js";
import { avisar, type Email } from "./email.js";
import { salvarAnexos } from "./anexos.js";
import * as modelos from "./modelos-email.js";
import { clienteRespondeu, enfileirar, interromperTriagem, triagemAtiva } from "./triagem.js";
import { aposMudanca } from "./prazos.js";

export const TIPOS = { incidente: "Erro / problema", duvida: "Dúvida", solicitacao: "Solicitação", melhoria: "Melhoria" } as const;
export const IMPACTOS = { pessoa: "Só eu", setor: "Meu setor", empresa: "A empresa toda / operação parada" } as const;
export const PRIORIDADES = { baixa: "Baixa", normal: "Normal", alta: "Alta", critica: "Crítica" } as const;
export const SITUACOES_EQUIPE = {
  triagem: "Em triagem", novo: "Novo", atribuido: "Atribuído", em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente", resolvido: "Resolvido", fechado: "Fechado", cancelado: "Cancelado",
} as const;
export const SITUACOES_CLIENTE = {
  triagem: "Em análise", novo: "Aguardando atendimento", atribuido: "Aguardando atendimento", em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando sua resposta", resolvido: "Resolvido — confirme", fechado: "Encerrado", cancelado: "Cancelado",
} as const;
export type Situacao = keyof typeof SITUACOES_EQUIPE;

export const ABERTAS: Situacao[] = ["triagem", "novo", "atribuido", "em_atendimento", "aguardando_cliente", "resolvido"];
export const ENCERRADAS: Situacao[] = ["fechado", "cancelado"];

// Prioridade inicial a partir do impacto informado pelo cliente (a OCP ajusta na distribuição).
export const prioridadeInicial = (impacto: string) => (impacto === "empresa" ? "alta" : "normal");

/** Filtro SQL (alias "c") do que cada perfil enxerga. Toda consulta de chamado passa por aqui. */
export function filtroVisibilidade(u: UsuarioSessao): { sql: string; params: unknown[] } {
  switch (u.papel) {
    case "admin": return { sql: "TRUE", params: [] };
    case "analista": return {
      sql: "(c.responsavel_id = ? OR c.area_id IN (SELECT area_id FROM analista_areas WHERE usuario_id = ?))",
      params: [u.id, u.id],
    };
    case "gestor": return { sql: "c.cliente_id = ?", params: [u.clienteId] };
    case "usuario": return { sql: "(c.cliente_id = ? AND c.solicitante_id = ?)", params: [u.clienteId, u.id] };
  }
}

export const SELECT_CHAMADO = `
  SELECT c.*, cl.nome AS cliente, s.nome AS solicitante_nome, s.email AS solicitante_email,
         d.nome AS departamento, si.nome AS sistema, si.acesso AS sistema_acesso, a.nome AS area,
         r.nome AS responsavel_nome, r.email AS responsavel_email
  FROM chamados c
  JOIN clientes cl ON cl.id = c.cliente_id
  JOIN usuarios s ON s.id = c.solicitante_id
  LEFT JOIN departamentos d ON d.id = c.departamento_id
  LEFT JOIN sistemas si ON si.id = c.sistema_id
  LEFT JOIN areas a ON a.id = c.area_id
  LEFT JOIN usuarios r ON r.id = c.responsavel_id`;

export async function buscarChamado(u: UsuarioSessao, id: number): Promise<any | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const f = filtroVisibilidade(u);
  const [linhas] = await pool.query<any[]>(`${SELECT_CHAMADO} WHERE c.id = ? AND ${f.sql}`, [id, ...f.params]);
  return linhas[0] ?? null;
}

/** Mensagens (com anexos) em ordem. O cliente nunca recebe as internas. */
export async function conversa(chamadoId: number, incluirInternas: boolean): Promise<any[]> {
  const filtro = incluirInternas ? "" : "AND m.visibilidade = 'publica'";
  const [mensagens] = await pool.query<any[]>(
    `SELECT m.*, CASE m.origem WHEN 'ia' THEN 'Assistente virtual OCP' WHEN 'sistema' THEN 'Sistema' ELSE u.nome END AS autor,
       u.papel AS autor_papel FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id
     WHERE m.chamado_id = ? ${filtro} ORDER BY m.criado_em, m.id`,
    [chamadoId],
  );
  const [anexos] = await pool.query<any[]>(
    "SELECT id, mensagem_id, nome, tipo, tamanho FROM anexos WHERE chamado_id = ? ORDER BY id", [chamadoId],
  );
  for (const m of mensagens) m.anexos = anexos.filter((a) => a.mensagem_id === m.id);
  return mensagens;
}

export async function historico(chamadoId: number): Promise<any[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT a.acao, a.detalhes, a.ip, a.criado_em, u.nome AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.chamado_id = ? ORDER BY a.id`,
    [chamadoId],
  );
  return linhas;
}

async function emTransacao<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await fn(conexao);
    await conexao.commit();
    return resultado;
  } catch (e) {
    await conexao.rollback();
    throw e;
  } finally {
    conexao.release();
  }
}

async function inserirMensagem(
  c: PoolConnection, chamadoId: number, autorId: number | null, visibilidade: "publica" | "interna", texto: string,
  arquivos: Express.Multer.File[] = [],
): Promise<number> {
  const [r] = await c.query<any>(
    "INSERT INTO mensagens (chamado_id, autor_id, origem, visibilidade, texto) VALUES (?, ?, ?, ?, ?)",
    [chamadoId, autorId, autorId ? "pessoa" : "sistema", visibilidade, texto],
  );
  if (autorId) await salvarAnexos(c, arquivos, chamadoId, r.insertId, autorId);
  return r.insertId;
}

async function administradores(): Promise<{ nome: string; email: string }[]> {
  const [linhas] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE papel = 'admin' AND ativo");
  return linhas;
}

// Quem da OCP recebe a resposta do cliente: o responsável ou, sem responsável, os administradores.
async function equipeDoChamado(ch: any): Promise<{ nome: string; email: string }[]> {
  return ch.responsavel_id ? [{ nome: ch.responsavel_nome, email: ch.responsavel_email }] : administradores();
}

export interface NovoChamado {
  clienteId: number;
  solicitanteId: number;
  departamentoId: number | null;
  sistemaId: number | null;
  titulo: string;
  tipo: keyof typeof TIPOS;
  impacto: keyof typeof IMPACTOS;
  descricao: string;
  canal: "portal" | "painel";
}

export async function abrirChamado(req: Request, dados: NovoChamado, arquivos: Express.Multer.File[]): Promise<number> {
  const autor = req.session.usuario!;
  // Com a triagem ligada, o chamado passa primeiro pelo assistente; a equipe é avisada quando a ficha fica pronta.
  const comTriagem = await triagemAtiva();
  const id = await emTransacao(async (c) => {
    const [r] = await c.query<any>(
      `INSERT INTO chamados (cliente_id, solicitante_id, aberto_por_id, departamento_id, sistema_id, titulo, tipo, impacto, prioridade,
         canal, status, texto_busca)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [dados.clienteId, dados.solicitanteId, autor.id, dados.departamentoId, dados.sistemaId, dados.titulo, dados.tipo,
        dados.impacto, prioridadeInicial(dados.impacto), dados.canal, comTriagem ? "triagem" : "novo", dados.descricao],
    );
    // A descrição é a primeira mensagem pública (autor: quem registrou); os anexos ficam nela.
    await inserirMensagem(c, r.insertId, autor.id, "publica", dados.descricao, arquivos);
    return r.insertId as number;
  });
  await registrar(req, "chamado_aberto", { chamado_id: id, canal: dados.canal, solicitante_id: dados.solicitanteId });
  await aposMudanca(id);

  const ch = await buscarChamado({ ...autor, papel: "admin" }, id);
  const emails: Email[] = [modelos.chamadoAberto({ nome: ch.solicitante_nome, email: ch.solicitante_email }, ch)];
  if (comTriagem) {
    // Aberto pela equipe em nome do cliente: só gera a ficha, sem perguntas.
    await enfileirar(id, dados.canal === "painel");
  } else {
    for (const adm of await administradores()) {
      if (adm.email !== autor.email) emails.push(modelos.novoChamado(adm, ch, ch.solicitante_nome, dados.descricao));
    }
  }
  avisar(emails);
  return id;
}

/** Resposta do cliente. Volta o chamado para a equipe (e reabre se estava resolvido). */
export async function responderComoCliente(req: Request, ch: any, texto: string, arquivos: Express.Multer.File[]): Promise<void> {
  const u = req.session.usuario!;
  if (ENCERRADAS.includes(ch.status)) throw new RegraChamado("Este chamado está encerrado. Abra um novo chamado.");
  const reaberto = ch.status === "resolvido";
  const novoStatus: Situacao = ["aguardando_cliente", "resolvido"].includes(ch.status)
    ? (ch.responsavel_id ? "em_atendimento" : "novo")
    : ch.status;
  await emTransacao(async (c) => {
    await inserirMensagem(c, ch.id, u.id, "publica", texto, arquivos);
    await c.query(
      "UPDATE chamados SET status = ?, resolvido_em = IF(? , NULL, resolvido_em), atualizado_em = UTC_TIMESTAMP() WHERE id = ?",
      [novoStatus, reaberto, ch.id],
    );
  });
  await registrar(req, reaberto ? "chamado_reaberto" : "resposta_cliente", { chamado_id: ch.id, status: novoStatus });
  await aposMudanca(ch.id);
  if (ch.status === "triagem") {
    // Respondeu às perguntas do assistente: a equipe ainda não está no chamado; volta para a fila da triagem.
    await clienteRespondeu(ch.id);
    return;
  }
  avisar((await equipeDoChamado(ch)).map((p) => modelos.respostaParaEquipe(p, ch, u.nome, texto, reaberto)));
}

export const STATUS_RESPOSTA_EQUIPE = ["em_atendimento", "aguardando_cliente", "resolvido"] as const;

/** Resposta ou nota interna da equipe, com mudança opcional de situação. */
export async function responderComoEquipe(
  req: Request, ch: any, texto: string, interna: boolean, statusPedido: string, arquivos: Express.Multer.File[],
): Promise<void> {
  const u = req.session.usuario!;
  if (ENCERRADAS.includes(ch.status) && !interna) throw new RegraChamado("Chamado encerrado: reabra antes de responder ao cliente.");
  let novoStatus: Situacao = ch.status;
  if ((STATUS_RESPOSTA_EQUIPE as readonly string[]).includes(statusPedido)) novoStatus = statusPedido as Situacao;
  else if (!interna && ["novo", "atribuido", "triagem"].includes(ch.status)) novoStatus = "em_atendimento";
  if (interna && novoStatus !== ch.status && novoStatus !== "em_atendimento") {
    throw new RegraChamado("Para pedir informações ou marcar como resolvido, escreva uma resposta ao cliente (não uma nota interna).");
  }
  if (ENCERRADAS.includes(ch.status)) novoStatus = ch.status;
  // Quem responde sem responsável definido assume o chamado.
  const assumir = !ch.responsavel_id;
  const resolvidoAgora = novoStatus === "resolvido" && ch.status !== "resolvido";
  const manterResolvidoEm = ["resolvido", ...ENCERRADAS].includes(novoStatus);

  await emTransacao(async (c) => {
    await inserirMensagem(c, ch.id, u.id, interna ? "interna" : "publica", texto, arquivos);
    await c.query(
      `UPDATE chamados SET status = ?, atualizado_em = UTC_TIMESTAMP(),
         responsavel_id = COALESCE(responsavel_id, ?),
         primeira_resposta_em = IF(? AND primeira_resposta_em IS NULL, UTC_TIMESTAMP(), primeira_resposta_em),
         resolvido_em = CASE WHEN ? THEN UTC_TIMESTAMP() WHEN ? THEN resolvido_em ELSE NULL END
       WHERE id = ?`,
      [novoStatus, u.id, !interna, resolvidoAgora, manterResolvidoEm, ch.id],
    );
  });
  if (novoStatus !== "triagem") await interromperTriagem(ch.id);
  await aposMudanca(ch.id);
  await registrar(req, interna ? "nota_interna" : "resposta_equipe", {
    chamado_id: ch.id, status: novoStatus !== ch.status ? novoStatus : undefined, assumiu: assumir || undefined,
  });
  if (!interna) {
    const p = { nome: ch.solicitante_nome, email: ch.solicitante_email };
    avisar([novoStatus === "resolvido"
      ? modelos.chamadoResolvido(p, ch, texto)
      : modelos.respostaParaCliente(p, ch, u.nome, texto, novoStatus === "aguardando_cliente")]);
  }
}

/** Distribuição (administrador): área, responsável, prioridade e tipo. */
export async function distribuir(
  req: Request, ch: any, dados: { areaId: number | null; responsavelId: number | null; prioridade: string; tipo: string },
): Promise<void> {
  const u = req.session.usuario!;
  if (dados.responsavelId) {
    const [r] = await pool.query<any[]>(
      "SELECT id FROM usuarios WHERE id = ? AND ativo AND papel IN ('admin', 'analista')", [dados.responsavelId],
    );
    if (!r.length) throw new RegraChamado("Responsável inválido.");
  }
  if (dados.areaId) {
    const [a] = await pool.query<any[]>("SELECT id FROM areas WHERE id = ? AND ativo", [dados.areaId]);
    if (!a.length) throw new RegraChamado("Área inválida.");
  }
  if (!(dados.prioridade in PRIORIDADES) || !(dados.tipo in TIPOS)) throw new RegraChamado("Prioridade ou tipo inválido.");

  let status: Situacao = ch.status;
  if (dados.responsavelId && ["novo", "triagem"].includes(ch.status)) status = "atribuido";
  if (!dados.responsavelId && ch.status === "atribuido") status = "novo";

  await pool.query(
    "UPDATE chamados SET area_id = ?, responsavel_id = ?, prioridade = ?, tipo = ?, status = ?, atualizado_em = UTC_TIMESTAMP() WHERE id = ?",
    [dados.areaId, dados.responsavelId, dados.prioridade, dados.tipo, status, ch.id],
  );
  const mudou = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null);
  const alteracoes = {
    area_id: mudou(ch.area_id, dados.areaId) ? dados.areaId : undefined,
    responsavel_id: mudou(ch.responsavel_id, dados.responsavelId) ? dados.responsavelId : undefined,
    prioridade: ch.prioridade !== dados.prioridade ? dados.prioridade : undefined,
    tipo: ch.tipo !== dados.tipo ? dados.tipo : undefined,
    status: status !== ch.status ? status : undefined,
  };
  if (status !== "triagem") await interromperTriagem(ch.id);
  await aposMudanca(ch.id, { prioridadeMudou: ch.prioridade !== dados.prioridade });
  await registrar(req, "chamado_distribuido", { chamado_id: ch.id, ...alteracoes });

  if (dados.responsavelId && mudou(ch.responsavel_id, dados.responsavelId) && dados.responsavelId !== u.id) {
    const [r] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE id = ?", [dados.responsavelId]);
    avisar([modelos.chamadoAtribuido(r[0], ch, u.nome)]);
  }
}

/** Analista pega para si um chamado da sua área que está sem responsável. */
export async function assumir(req: Request, ch: any): Promise<void> {
  if (ch.responsavel_id) throw new RegraChamado("Este chamado já tem responsável.");
  if (ENCERRADAS.includes(ch.status)) throw new RegraChamado("Chamado encerrado.");
  const u = req.session.usuario!;
  await pool.query(
    "UPDATE chamados SET responsavel_id = ?, status = IF(status IN ('novo', 'triagem'), 'atribuido', status), atualizado_em = UTC_TIMESTAMP() WHERE id = ? AND responsavel_id IS NULL",
    [u.id, ch.id],
  );
  await interromperTriagem(ch.id);
  await aposMudanca(ch.id);
  await registrar(req, "chamado_assumido", { chamado_id: ch.id });
}

/** Cliente confirma que o problema foi resolvido. */
export async function confirmarSolucao(req: Request, ch: any): Promise<void> {
  if (ch.status !== "resolvido") throw new RegraChamado("O chamado não está aguardando confirmação.");
  await pool.query("UPDATE chamados SET status = 'fechado', fechado_em = UTC_TIMESTAMP(), atualizado_em = UTC_TIMESTAMP() WHERE id = ?", [ch.id]);
  await aposMudanca(ch.id);
  await registrar(req, "solucao_confirmada", { chamado_id: ch.id });
}

/** Cancelamento: o cliente, enquanto ninguém resolveu; a equipe (administrador), a qualquer momento antes de fechar. */
export async function cancelar(req: Request, ch: any, motivo: string): Promise<void> {
  const u = req.session.usuario!;
  const pelaEquipe = u.papel === "admin";
  if (ENCERRADAS.includes(ch.status) || (!pelaEquipe && ch.status === "resolvido")) {
    throw new RegraChamado("Este chamado não pode mais ser cancelado.");
  }
  await emTransacao(async (c) => {
    await inserirMensagem(c, ch.id, u.id, "publica", `Chamado cancelado${motivo ? `: ${motivo}` : "."}`);
    await c.query("UPDATE chamados SET status = 'cancelado', fechado_em = UTC_TIMESTAMP(), atualizado_em = UTC_TIMESTAMP() WHERE id = ?", [ch.id]);
  });
  await interromperTriagem(ch.id);
  await aposMudanca(ch.id);
  await registrar(req, "chamado_cancelado", { chamado_id: ch.id, motivo });
  if (pelaEquipe) {
    avisar([modelos.respostaParaCliente({ nome: ch.solicitante_nome, email: ch.solicitante_email }, ch, u.nome, `Chamado cancelado${motivo ? `: ${motivo}` : "."}`, false)]);
  } else {
    avisar((await equipeDoChamado(ch)).map((p) => modelos.respostaParaEquipe(p, ch, u.nome, `Chamado cancelado pelo cliente${motivo ? `: ${motivo}` : "."}`, false)));
  }
}

/** Reabre um chamado encerrado ou resolvido (administrador). */
export async function reabrir(req: Request, ch: any): Promise<void> {
  if (![...ENCERRADAS, "resolvido"].includes(ch.status)) throw new RegraChamado("O chamado já está aberto.");
  const status = ch.responsavel_id ? "em_atendimento" : "novo";
  await pool.query(
    "UPDATE chamados SET status = ?, resolvido_em = NULL, fechado_em = NULL, atualizado_em = UTC_TIMESTAMP() WHERE id = ?", [status, ch.id],
  );
  await aposMudanca(ch.id);
  await registrar(req, "chamado_reaberto", { chamado_id: ch.id, status });
}

/** Tarefa periódica: resolvido sem resposta do cliente fecha sozinho. */
export async function fecharResolvidosAntigos(dias: number): Promise<number> {
  const [linhas] = await pool.query<any[]>(
    "SELECT id FROM chamados WHERE status = 'resolvido' AND resolvido_em < UTC_TIMESTAMP() - INTERVAL ? DAY", [dias],
  );
  for (const { id } of linhas) {
    await emTransacao(async (c) => {
      await inserirMensagem(c, id, null, "publica", `Chamado encerrado automaticamente: sem retorno ${dias} dias depois de resolvido.`);
      await c.query("UPDATE chamados SET status = 'fechado', fechado_em = UTC_TIMESTAMP(), atualizado_em = UTC_TIMESTAMP() WHERE id = ? AND status = 'resolvido'", [id]);
    });
    await aposMudanca(id);
    await registrar(null, "fechado_automaticamente", { chamado_id: id }, null);
  }
  return linhas.length;
}

export class RegraChamado extends Error {}
