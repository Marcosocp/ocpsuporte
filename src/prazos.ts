// Prazos de atendimento (SLA) em horário útil.
// - Começam quando o chamado chega à equipe (depois da triagem): sla_inicio_em.
// - 1ª resposta: até a primeira resposta pública da equipe.
// - Solução: até "resolvido". Fica PAUSADO enquanto se espera o cliente (aguardando cliente / resolvido aguardando
//   confirmação); cada pausa fechada empurra o prazo pelo tempo útil que durou.
// Os prazos calculados ficam gravados no chamado (para ordenar a fila e disparar avisos) e são refeitos a cada mudança.
import { pool } from "./db/conexao.js";
import { registrar } from "./auditoria.js";
import { avisar, type Email } from "./email.js";
import * as modelos from "./modelos-email.js";
import { minutosUteis, somarMinutosUteis, duracaoUtil, type Feriados } from "./expediente.js";

const PAUSA = ["aguardando_cliente", "resolvido"];
const ENCERRADA = ["fechado", "cancelado"];

let feriados: Feriados = new Set();
export async function carregarFeriados(): Promise<void> {
  const [linhas] = await pool.query<any[]>("SELECT DATE_FORMAT(data, '%Y-%m-%d') AS d FROM feriados");
  feriados = new Set(linhas.map((l) => l.d));
}
export const feriadosAtuais = () => feriados;

export async function prazosDe(clienteId: number, prioridade: string): Promise<{ resposta_min: number; solucao_min: number }> {
  const [linhas] = await pool.query<any[]>(
    `SELECT resposta_min, solucao_min FROM prazos_cliente WHERE cliente_id = ? AND prioridade = ?
     UNION ALL SELECT resposta_min, solucao_min FROM prazos_padrao WHERE prioridade = ? LIMIT 1`,
    [clienteId, prioridade, prioridade],
  );
  return linhas[0];
}

/**
 * Depois de qualquer mudança no chamado: abre/fecha a pausa conforme a situação, marca o início do prazo e
 * recalcula os prazos. Idempotente — pode ser chamada quantas vezes for preciso.
 */
export async function aposMudanca(chamadoId: number, opcoes: { prioridadeMudou?: boolean } = {}): Promise<void> {
  const [linhas] = await pool.query<any[]>(
    "SELECT id, cliente_id, prioridade, status, sla_inicio_em FROM chamados WHERE id = ?", [chamadoId],
  );
  const ch = linhas[0];
  if (!ch || ch.status === "triagem") return;
  if (!ch.sla_inicio_em) {
    await pool.query("UPDATE chamados SET sla_inicio_em = UTC_TIMESTAMP() WHERE id = ? AND sla_inicio_em IS NULL", [chamadoId]);
  }
  const [aberta] = await pool.query<any[]>("SELECT id FROM chamado_pausas WHERE chamado_id = ? AND fim IS NULL", [chamadoId]);
  if (PAUSA.includes(ch.status) && !aberta.length) {
    await pool.query("INSERT INTO chamado_pausas (chamado_id, inicio) VALUES (?, UTC_TIMESTAMP())", [chamadoId]);
  } else if (!PAUSA.includes(ch.status) && aberta.length) {
    await pool.query("UPDATE chamado_pausas SET fim = UTC_TIMESTAMP() WHERE id = ?", [aberta[0].id]);
  }
  if (opcoes.prioridadeMudou) {
    // Prazo novo: os avisos voltam a valer.
    await pool.query(
      `UPDATE chamados SET sla_aviso_resposta_em = NULL, sla_aviso_solucao_em = NULL, sla_estouro_resposta_em = NULL,
         sla_estouro_solucao_em = NULL WHERE id = ?`,
      [chamadoId],
    );
  }
  await recalcular(chamadoId);
}

export async function recalcular(chamadoId: number): Promise<void> {
  const [linhas] = await pool.query<any[]>("SELECT id, cliente_id, prioridade, sla_inicio_em FROM chamados WHERE id = ?", [chamadoId]);
  const ch = linhas[0];
  if (!ch?.sla_inicio_em) return;
  const p = await prazosDe(ch.cliente_id, ch.prioridade);
  const [pausas] = await pool.query<any[]>("SELECT inicio, fim FROM chamado_pausas WHERE chamado_id = ? AND fim IS NOT NULL", [chamadoId]);
  const pausado = pausas.reduce((t, x) => t + minutosUteis(x.inicio, x.fim, feriados), 0);
  await pool.query(
    "UPDATE chamados SET prazo_resposta_em = ?, prazo_solucao_em = ? WHERE id = ?",
    [somarMinutosUteis(ch.sla_inicio_em, p.resposta_min, feriados), somarMinutosUteis(ch.sla_inicio_em, p.solucao_min + pausado, feriados), chamadoId],
  );
}

/** Refaz os prazos dos chamados abertos (mudou a tabela de prazos ou os feriados). */
export async function recalcularAbertos(clienteId: number | null = null): Promise<number> {
  const [linhas] = await pool.query<any[]>(
    `SELECT id FROM chamados WHERE status NOT IN ('fechado', 'cancelado', 'triagem') AND sla_inicio_em IS NOT NULL ${clienteId ? "AND cliente_id = ?" : ""}`,
    clienteId ? [clienteId] : [],
  );
  for (const { id } of linhas) await recalcular(id);
  return linhas.length;
}

// --- Situação para as telas ---

export interface SituacaoPrazo { estado: "sem" | "ok" | "atencao" | "atrasado" | "cumprido" | "cumprido_atrasado" | "pausado"; texto: string }

// Aviso quando falta 25% do prazo (no máximo 1 h útil).
const limiarAviso = (inicio: Date, prazo: Date) => Math.min(60, Math.ceil(minutosUteis(inicio, prazo, feriados) * 0.25));

function pendente(inicio: Date, prazo: Date, agora: Date): SituacaoPrazo {
  if (agora >= prazo) return { estado: "atrasado", texto: `atrasado ${duracaoUtil(minutosUteis(prazo, agora, feriados))}` };
  const resta = minutosUteis(agora, prazo, feriados);
  return { estado: resta <= limiarAviso(inicio, prazo) ? "atencao" : "ok", texto: `vence em ${duracaoUtil(resta)}` };
}

export function situacaoPrazos(ch: any, agora = new Date()): { resposta: SituacaoPrazo; solucao: SituacaoPrazo } {
  const sem: SituacaoPrazo = { estado: "sem", texto: "—" };
  if (!ch.sla_inicio_em || !ch.prazo_resposta_em || ch.status === "cancelado") return { resposta: sem, solucao: sem };
  const inicio = new Date(ch.sla_inicio_em);
  const pResp = new Date(ch.prazo_resposta_em);
  const pSol = new Date(ch.prazo_solucao_em);

  const resposta: SituacaoPrazo = ch.primeira_resposta_em
    ? new Date(ch.primeira_resposta_em) <= pResp ? { estado: "cumprido", texto: "no prazo" } : { estado: "cumprido_atrasado", texto: "fora do prazo" }
    : ENCERRADA.includes(ch.status) ? sem : pendente(inicio, pResp, agora);

  let solucao: SituacaoPrazo;
  if (ch.resolvido_em) {
    // Resolvido: compara com o prazo da época (as pausas de antes de resolver já estão nele).
    solucao = new Date(ch.resolvido_em) <= pSol ? { estado: "cumprido", texto: "no prazo" } : { estado: "cumprido_atrasado", texto: "fora do prazo" };
    if (ch.status === "resolvido") solucao = { ...solucao, texto: `${solucao.texto} · aguardando confirmação` };
  } else if (ENCERRADA.includes(ch.status)) {
    solucao = sem;
  } else if (PAUSA.includes(ch.status)) {
    solucao = { estado: "pausado", texto: "pausado: aguardando cliente" };
  } else {
    solucao = pendente(inicio, pSol, agora);
  }
  return { resposta, solucao };
}

// --- Avisos (tarefa periódica) ---

async function administradores(): Promise<{ nome: string; email: string }[]> {
  const [linhas] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE papel = 'admin' AND ativo");
  return linhas;
}

/** Avisa antes de vencer (responsável, ou administradores se não houver) e escala quando estoura (responsável + administradores). */
export async function verificarPrazos(agora = new Date()): Promise<number> {
  const [linhas] = await pool.query<any[]>(
    `SELECT c.*, cl.nome AS cliente, r.nome AS responsavel_nome, r.email AS responsavel_email
     FROM chamados c JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN usuarios r ON r.id = c.responsavel_id
     WHERE c.status IN ('novo', 'atribuido', 'em_atendimento') AND c.prazo_resposta_em IS NOT NULL`,
  );
  const admins = await administradores();
  let enviados = 0;
  for (const ch of linhas) {
    const responsavel = ch.responsavel_id ? [{ nome: ch.responsavel_nome, email: ch.responsavel_email }] : [];
    const checar = async (tipo: "resposta" | "solucao", prazo: Date | null, feito: unknown) => {
      if (!prazo || feito) return;
      const colAviso = `sla_aviso_${tipo}_em`;
      const colEstouro = `sla_estouro_${tipo}_em`;
      let emails: Email[] = [];
      let coluna: string | null = null;
      if (agora >= prazo && !ch[colEstouro]) {
        const destinos = [...responsavel, ...admins].filter((p, i, l) => l.findIndex((q) => q.email === p.email) === i);
        emails = destinos.map((p) => modelos.prazoAlerta(p, ch, tipo, true, prazo));
        coluna = colEstouro;
      } else if (agora < prazo && !ch[colAviso] && minutosUteis(agora, prazo, feriados) <= limiarAviso(new Date(ch.sla_inicio_em), prazo)) {
        emails = (responsavel.length ? responsavel : admins).map((p) => modelos.prazoAlerta(p, ch, tipo, false, prazo));
        coluna = colAviso;
      }
      if (!coluna) return;
      const [r] = await pool.query<any>(`UPDATE chamados SET ${coluna} = UTC_TIMESTAMP() WHERE id = ? AND ${coluna} IS NULL`, [ch.id]);
      if (!r.affectedRows) return;
      await registrar(null, coluna.startsWith("sla_estouro") ? "prazo_estourado" : "prazo_vencendo", { chamado_id: ch.id, tipo }, null);
      avisar(emails);
      enviados += emails.length;
    };
    await checar("resposta", ch.prazo_resposta_em, ch.primeira_resposta_em);
    await checar("solucao", ch.prazo_solucao_em, ch.resolvido_em);
  }
  return enviados;
}
