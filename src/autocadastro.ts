// Link de cadastro por cliente. Quem tem o link só PEDE acesso; a conta é criada quando o administrador aprova
// (aí a pessoa recebe o convite normal para definir a senha). Recusar não avisa ninguém.
import type { Request } from "express";
import { pool } from "./db/conexao.js";
import { config } from "./config.js";
import { registrar, ipLegivel } from "./auditoria.js";
import { avisar } from "./email.js";
import { pedidoDeAcesso } from "./modelos-email.js";
import { novoToken, formatoToken } from "./tokens.js";
import { ErroCadastro, criarUsuarioCliente, dadosPessoa, departamentosValidos } from "./cadastro.js";
import { ids, texto } from "./formulario.js";

export const VALIDADES = { "7": "7 dias", "30": "30 dias", "90": "90 dias", sem: "Sem prazo (até revogar)" } as const;
// Teto de pedidos pendentes por cliente: um link vazado não enche a fila.
const MAX_PENDENTES = 30;

export const enderecoDoLink = (token: string) => `${config.baseUrl}/conta/cadastro/${token}`;

/** Link que vale hoje para o cliente (no máximo um). */
export async function linkAtivo(clienteId: number): Promise<any | null> {
  const [linhas] = await pool.query<any[]>(
    `SELECT * FROM links_cadastro WHERE cliente_id = ? AND revogado_em IS NULL AND (expira_em IS NULL OR expira_em > UTC_TIMESTAMP())
     ORDER BY id DESC LIMIT 1`,
    [clienteId],
  );
  return linhas[0] ?? null;
}

/** Gera um link novo; o anterior deixa de valer. */
export async function gerarLink(req: Request, clienteId: number, validade: unknown): Promise<void> {
  const dias = typeof validade === "string" && Object.hasOwn(VALIDADES, validade) && validade !== "sem" ? Number(validade) : null;
  await pool.query("UPDATE links_cadastro SET revogado_em = UTC_TIMESTAMP() WHERE cliente_id = ? AND revogado_em IS NULL", [clienteId]);
  await pool.query(
    `INSERT INTO links_cadastro (cliente_id, token, expira_em, criado_por)
     VALUES (?, ?, ${dias ? "UTC_TIMESTAMP() + INTERVAL ? DAY" : "NULL"}, ?)`,
    dias ? [clienteId, novoToken(), dias, req.session.usuario!.id] : [clienteId, novoToken(), req.session.usuario!.id],
  );
  await registrar(req, "link_cadastro_gerado", { cliente_id: clienteId, dias });
}

export async function revogarLink(req: Request, clienteId: number): Promise<void> {
  await pool.query("UPDATE links_cadastro SET revogado_em = UTC_TIMESTAMP() WHERE cliente_id = ? AND revogado_em IS NULL", [clienteId]);
  await registrar(req, "link_cadastro_revogado", { cliente_id: clienteId });
}

/** Link válido de um cliente ativo, ou null (link errado, vencido, revogado ou cliente desativado). */
export async function linkPorToken(token: unknown): Promise<any | null> {
  if (!formatoToken(token)) return null;
  const [linhas] = await pool.query<any[]>(
    `SELECT l.id, l.cliente_id, c.nome AS cliente FROM links_cadastro l JOIN clientes c ON c.id = l.cliente_id
     WHERE l.token = ? AND l.revogado_em IS NULL AND (l.expira_em IS NULL OR l.expira_em > UTC_TIMESTAMP()) AND c.ativo`,
    [token],
  );
  return linhas[0] ?? null;
}

/**
 * Registra o pedido. Para quem preenche a resposta é sempre a mesma (não revela se o e-mail já tem conta).
 * Pedido repetido do mesmo e-mail atualiza o pendente em vez de criar outro.
 */
export async function solicitar(req: Request, link: { id: number; cliente_id: number; cliente: string }, body: any): Promise<void> {
  const { nome, email, celular } = dadosPessoa(body);
  const cargo = texto(body.cargo, 150) || null;
  const departamentos = await departamentosValidos(link.cliente_id, body.departamentos);
  const [ativos] = departamentos.length
    ? await pool.query<any[]>("SELECT id FROM departamentos WHERE id IN (?) AND ativo", [departamentos])
    : [[]];
  if (ativos.length !== departamentos.length) throw new ErroCadastro("Departamento inválido.");

  const [existe] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ?", [email]);
  if (existe.length) {
    await registrar(req, "pedido_acesso_ignorado", { cliente_id: link.cliente_id, email, motivo: "e-mail já cadastrado" }, null);
    return;
  }
  const valores = [nome, celular, cargo, departamentos.join(",") || null, ipLegivel(req.ip)];
  const [r] = await pool.query<any>(
    `UPDATE solicitacoes_cadastro SET nome = ?, celular = ?, cargo = ?, departamento_ids = ?, ip = ?, criado_em = UTC_TIMESTAMP()
     WHERE cliente_id = ? AND email = ? AND status = 'pendente'`,
    [...valores, link.cliente_id, email],
  );
  if (r.affectedRows) {
    await registrar(req, "pedido_acesso_atualizado", { cliente_id: link.cliente_id, email }, null);
    return;
  }
  const [pend] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM solicitacoes_cadastro WHERE cliente_id = ? AND status = 'pendente'", [link.cliente_id]);
  if (pend[0].n >= MAX_PENDENTES) throw new ErroCadastro("Há muitos pedidos aguardando análise. Fale com a OCP.");
  const [novo] = await pool.query<any>(
    `INSERT INTO solicitacoes_cadastro (nome, celular, cargo, departamento_ids, ip, cliente_id, link_id, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [...valores, link.cliente_id, link.id, email],
  );
  await registrar(req, "pedido_acesso", { cliente_id: link.cliente_id, solicitacao_id: novo.insertId, email }, null);
  const [admins] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE papel = 'admin' AND ativo");
  avisar(admins.map((a) => pedidoDeAcesso(a, { nome, email, cargo, cliente: link.cliente })));
}

/** Pedidos pendentes (de um cliente ou de todos), com os nomes dos departamentos. */
export async function pendentes(clienteId: number | null = null): Promise<any[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT s.*, c.nome AS cliente FROM solicitacoes_cadastro s JOIN clientes c ON c.id = s.cliente_id
     WHERE s.status = 'pendente' ${clienteId ? "AND s.cliente_id = ?" : ""} ORDER BY s.criado_em`,
    clienteId ? [clienteId] : [],
  );
  for (const s of linhas) s.departamento_ids = s.departamento_ids ? String(s.departamento_ids).split(",").map(Number) : [];
  return linhas;
}

export async function contarPendentes(): Promise<number> {
  const [linhas] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM solicitacoes_cadastro WHERE status = 'pendente'");
  return Number(linhas[0].n);
}

async function pedidoPendente(id: number): Promise<any> {
  const [linhas] = await pool.query<any[]>("SELECT * FROM solicitacoes_cadastro WHERE id = ? AND status = 'pendente'", [id]);
  if (!linhas[0]) throw new ErroCadastro("Esse pedido já foi analisado.");
  return linhas[0];
}

/**
 * Aprova: cria o usuário (perfil e departamentos escolhidos pelo administrador) e manda o convite.
 * O pedido é "travado" antes de criar, para dois cliques não criarem duas vezes.
 */
export async function aprovar(req: Request, id: number, body: any): Promise<string | void> {
  const s = await pedidoPendente(id);
  const [r] = await pool.query<any>(
    "UPDATE solicitacoes_cadastro SET status = 'aprovada', decidido_em = UTC_TIMESTAMP(), decidido_por = ? WHERE id = ? AND status = 'pendente'",
    [req.session.usuario!.id, id],
  );
  if (!r.affectedRows) throw new ErroCadastro("Esse pedido já foi analisado.");
  let conviteSaiu: boolean;
  try {
    conviteSaiu = await criarUsuarioCliente(req, s.cliente_id, {
      nome: s.nome, email: s.email, celular: s.celular ?? "", papel: body.papel, departamentos: ids(body.departamentos),
    });
  } catch (e) {
    await pool.query("UPDATE solicitacoes_cadastro SET status = 'pendente', decidido_em = NULL, decidido_por = NULL WHERE id = ?", [id]);
    throw e;
  }
  const [u] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ?", [s.email]);
  await pool.query("UPDATE solicitacoes_cadastro SET usuario_id = ? WHERE id = ?", [u[0].id, id]);
  await registrar(req, "pedido_acesso_aprovado", { cliente_id: s.cliente_id, solicitacao_id: id, usuario_id: u[0].id });
  if (!conviteSaiu) return "Acesso aprovado, mas o e-mail de convite falhou. Use “reenviar convite” na lista de usuários.";
}

export async function recusar(req: Request, id: number): Promise<void> {
  const s = await pedidoPendente(id);
  await pool.query(
    "UPDATE solicitacoes_cadastro SET status = 'recusada', decidido_em = UTC_TIMESTAMP(), decidido_por = ? WHERE id = ? AND status = 'pendente'",
    [req.session.usuario!.id, id],
  );
  await registrar(req, "pedido_acesso_recusado", { cliente_id: s.cliente_id, solicitacao_id: id, email: s.email });
}
