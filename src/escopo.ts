// Escopo da equipe: cada analista atende todos os clientes ou só os selecionados, e todas as áreas ou só as
// selecionadas. O administrador atende tudo. Usado na visibilidade dos chamados, na distribuição, nos avisos
// e nas sugestões da triagem.
import { pool } from "./db/conexao.js";
import type { UsuarioSessao } from "./auth.js";

/** SQL: o usuário (alias "u") atende o cliente indicado pela expressão SQL "cliente". */
export const atendeCliente = (cliente: string) =>
  `(u.papel = 'admin' OR u.todos_clientes OR EXISTS (SELECT 1 FROM analista_clientes ac WHERE ac.usuario_id = u.id AND ac.cliente_id = ${cliente}))`;

/** Quem da equipe pode ser responsável por chamados deste cliente (com as áreas, para as telas e a IA). */
export async function equipeDoCliente(clienteId: number): Promise<any[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT u.id, u.nome, u.email, u.papel, u.todas_areas, NOT u.todos_clientes AS dedicado,
       GROUP_CONCAT(DISTINCT a.nome ORDER BY a.nome SEPARATOR ', ') AS areas, GROUP_CONCAT(DISTINCT a.id) AS area_ids,
       (SELECT COUNT(*) FROM chamados c WHERE c.responsavel_id = u.id AND c.status NOT IN ('resolvido', 'fechado', 'cancelado')) AS abertos
     FROM usuarios u LEFT JOIN analista_areas aa ON aa.usuario_id = u.id LEFT JOIN areas a ON a.id = aa.area_id AND a.ativo
     WHERE u.ativo AND u.papel IN ('admin', 'analista') AND ${atendeCliente("?")}
     GROUP BY u.id ORDER BY dedicado DESC, u.nome`,
    [clienteId],
  );
  for (const l of linhas) {
    l.area_ids = l.area_ids ? String(l.area_ids).split(",").map(Number) : [];
    if (l.papel === "admin" || l.todas_areas) l.areas = "todas as áreas";
  }
  return linhas;
}

export async function atende(usuarioId: number, clienteId: number): Promise<boolean> {
  const [linhas] = await pool.query<any[]>(
    `SELECT 1 FROM usuarios u WHERE u.id = ? AND u.ativo AND u.papel IN ('admin', 'analista') AND ${atendeCliente("?")}`,
    [usuarioId, clienteId],
  );
  return linhas.length > 0;
}

/** Analistas alocados neste cliente (lista explícita de clientes que o inclui): recebem o aviso de chamado novo. */
export async function dedicados(clienteId: number): Promise<{ nome: string; email: string }[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT u.nome, u.email FROM usuarios u JOIN analista_clientes ac ON ac.usuario_id = u.id
     WHERE ac.cliente_id = ? AND u.ativo AND u.papel = 'analista' AND NOT u.todos_clientes`,
    [clienteId],
  );
  return linhas;
}

/** Clientes que este usuário da equipe atende (filtro da fila, abrir chamado em nome do cliente). */
export async function clientesDaEquipe(u: UsuarioSessao): Promise<any[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT c.id, c.nome FROM clientes c JOIN usuarios u ON u.id = ? WHERE c.ativo AND ${atendeCliente("c.id")} ORDER BY c.nome`,
    [u.id],
  );
  return linhas;
}
