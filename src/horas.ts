// Horas trabalhadas nos chamados e consumo do pacote mensal de cada cliente. Só a OCP vê.
// As horas não usadas zeram a cada mês. Aviso aos administradores em 80% e 100% do pacote.
import type { Request } from "express";
import { pool } from "./db/conexao.js";
import { registrar } from "./auditoria.js";
import { avisar } from "./email.js";
import * as modelos from "./modelos-email.js";
import { dataLocal } from "./expediente.js";

export class ErroHoras extends Error {}

export const NIVEIS_ALERTA = [80, 100];
const ehMes = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const mesOuAtual = (v: unknown) => (ehMes(v) ? v : dataLocal(new Date()).slice(0, 7));
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

function limitesDoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { primeiro: `${mes}-01`, ultimo: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Lança um apontamento num chamado. Data no passado (até 60 dias; o administrador pode qualquer data passada). */
export async function lancar(req: Request, ch: any, body: any): Promise<void> {
  const u = req.session.usuario!;
  const horas = Number(String(body.horas ?? "0").replace(",", ".")) || 0;
  const minutosExtras = Number(body.minutos ?? 0) || 0;
  const minutos = Math.round(horas * 60 + minutosExtras);
  const descricao = String(body.descricao ?? "").trim().slice(0, 500);
  const data = String(body.data ?? "");
  const hoje = dataLocal(new Date());
  if (!(minutos >= 1 && minutos <= 24 * 60)) throw new ErroHoras("Informe a duração (de 1 minuto a 24 horas).");
  if (!descricao) throw new ErroHoras("Descreva o que foi feito.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hoje) throw new ErroHoras("Data inválida (não pode ser no futuro).");
  const limite = dataLocal(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
  if (data < limite && u.papel !== "admin") throw new ErroHoras("Lançamentos com mais de 60 dias só pelo administrador.");
  const faturavel = u.papel === "admin" ? body.faturavel !== "0" : true;

  const [r] = await pool.query<any>(
    "INSERT INTO apontamentos (chamado_id, usuario_id, data, minutos, descricao, faturavel) VALUES (?, ?, ?, ?, ?, ?)",
    [ch.id, u.id, data, minutos, descricao, faturavel],
  );
  await registrar(req, "horas_lancadas", { chamado_id: ch.id, apontamento_id: r.insertId, data, minutos, faturavel });
  await verificarAlertas(ch.cliente_id, data.slice(0, 7));
}

/** Remove: quem lançou, no mesmo mês; o administrador, sempre. */
export async function remover(req: Request, ch: any, apontamentoId: number): Promise<void> {
  const u = req.session.usuario!;
  const [linhas] = await pool.query<any[]>(
    "SELECT id, usuario_id, DATE_FORMAT(data, '%Y-%m') AS mes, minutos FROM apontamentos WHERE id = ? AND chamado_id = ?", [apontamentoId, ch.id],
  );
  const ap = linhas[0];
  if (!ap) throw new ErroHoras("Lançamento não encontrado.");
  const mesAtual = dataLocal(new Date()).slice(0, 7);
  if (u.papel !== "admin" && (ap.usuario_id !== u.id || ap.mes !== mesAtual)) {
    throw new ErroHoras("Só quem lançou pode remover, e só dentro do mesmo mês. Fale com o administrador.");
  }
  await pool.query("DELETE FROM apontamentos WHERE id = ?", [apontamentoId]);
  await registrar(req, "horas_removidas", { chamado_id: ch.id, apontamento_id: apontamentoId, minutos: ap.minutos });
}

export async function doChamado(chamadoId: number): Promise<{ lista: any[]; total: number }> {
  const [lista] = await pool.query<any[]>(
    `SELECT a.*, DATE_FORMAT(a.data, '%Y-%m-%d') AS dia, u.nome AS usuario FROM apontamentos a JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.chamado_id = ? ORDER BY a.data, a.id`,
    [chamadoId],
  );
  return { lista, total: lista.reduce((t, a) => t + a.minutos, 0) };
}

/** Contrato que vale no mês (o mais recente que começou até o fim do mês e não terminou antes do início). */
export async function contratoDoMes(clienteId: number, mes: string): Promise<any | null> {
  const { primeiro, ultimo } = limitesDoMes(mes);
  const [linhas] = await pool.query<any[]>(
    "SELECT * FROM contratos WHERE cliente_id = ? AND inicio <= ? AND (fim IS NULL OR fim >= ?) ORDER BY inicio DESC LIMIT 1",
    [clienteId, ultimo, primeiro],
  );
  return linhas[0] ?? null;
}

export interface Consumo {
  clienteId: number; cliente: string; mes: string; contrato: any | null;
  pacoteMin: number | null; faturavelMin: number; naoFaturavelMin: number;
  percentual: number | null; excedenteMin: number; valorExcedente: number | null;
}

export async function consumo(clienteId: number, mes: string): Promise<Consumo> {
  const { primeiro, ultimo } = limitesDoMes(mes);
  const [cl] = await pool.query<any[]>("SELECT nome FROM clientes WHERE id = ?", [clienteId]);
  const [soma] = await pool.query<any[]>(
    `SELECT COALESCE(SUM(IF(a.faturavel, a.minutos, 0)), 0) AS fat, COALESCE(SUM(IF(a.faturavel, 0, a.minutos)), 0) AS nao
     FROM apontamentos a JOIN chamados c ON c.id = a.chamado_id WHERE c.cliente_id = ? AND a.data BETWEEN ? AND ?`,
    [clienteId, primeiro, ultimo],
  );
  const contrato = await contratoDoMes(clienteId, mes);
  const pacoteMin = contrato ? Math.round(Number(contrato.horas_mes) * 60) : null;
  const fat = Number(soma[0].fat);
  const excedenteMin = pacoteMin !== null ? Math.max(0, fat - pacoteMin) : 0;
  const valorHora = contrato?.valor_hora_excedente !== null && contrato?.valor_hora_excedente !== undefined ? Number(contrato.valor_hora_excedente) : null;
  return {
    clienteId, cliente: cl[0]?.nome ?? "", mes, contrato, pacoteMin, faturavelMin: fat, naoFaturavelMin: Number(soma[0].nao),
    percentual: pacoteMin ? Math.round((fat / pacoteMin) * 1000) / 10 : null,
    excedenteMin,
    valorExcedente: valorHora !== null ? Math.round((excedenteMin / 60) * valorHora * 100) / 100 : null,
  };
}

/** Avisa os administradores (uma vez por nível e mês) quando o consumo passa de 80% e de 100% do pacote. */
export async function verificarAlertas(clienteId: number, mes: string): Promise<void> {
  const c = await consumo(clienteId, mes);
  if (c.percentual === null) return;
  for (const nivel of NIVEIS_ALERTA) {
    if (c.percentual < nivel) continue;
    const [r] = await pool.query<any>("INSERT IGNORE INTO alertas_horas (cliente_id, mes, nivel) VALUES (?, ?, ?)", [clienteId, mes, nivel]);
    if (!r.affectedRows) continue;
    await registrar(null, "pacote_horas_alerta", { cliente_id: clienteId, mes, nivel, percentual: c.percentual }, null);
    const [admins] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE papel = 'admin' AND ativo");
    avisar(admins.map((p) => modelos.alertaHoras(p, c, nivel)));
  }
}

/** Relatório do mês: todos os clientes ativos (ou com horas no mês). */
export async function relatorioMes(mes: string): Promise<Consumo[]> {
  const { primeiro, ultimo } = limitesDoMes(mes);
  const [clientes] = await pool.query<any[]>(
    `SELECT id FROM clientes c WHERE c.ativo OR EXISTS (SELECT 1 FROM apontamentos a JOIN chamados ch ON ch.id = a.chamado_id
       WHERE ch.cliente_id = c.id AND a.data BETWEEN ? AND ?) ORDER BY c.nome`,
    [primeiro, ultimo],
  );
  return Promise.all(clientes.map((c) => consumo(c.id, mes)));
}

export async function lancamentosDoMes(clienteId: number, mes: string): Promise<any[]> {
  const { primeiro, ultimo } = limitesDoMes(mes);
  const [linhas] = await pool.query<any[]>(
    `SELECT a.id, DATE_FORMAT(a.data, '%Y-%m-%d') AS dia, a.minutos, a.descricao, a.faturavel, u.nome AS usuario,
            c.id AS chamado_id, c.titulo, s.nome AS solicitante
     FROM apontamentos a JOIN chamados c ON c.id = a.chamado_id JOIN usuarios u ON u.id = a.usuario_id JOIN usuarios s ON s.id = c.solicitante_id
     WHERE c.cliente_id = ? AND a.data BETWEEN ? AND ? ORDER BY a.data, c.id, a.id`,
    [clienteId, primeiro, ultimo],
  );
  return linhas;
}

/** CSV (separador ";" e BOM, para abrir direto no Excel em português). */
export function csv(linhas: any[]): string {
  // Texto que começa com = + - @ vira fórmula no Excel (o assunto vem do cliente): prefixo ' neutraliza.
  const campo = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const cab = ["Data", "Chamado", "Assunto", "Solicitante", "Analista", "Descrição", "Horas", "Minutos", "Conta no pacote"];
  const corpo = linhas.map((l) => [
    l.dia.split("-").reverse().join("/"), `#${String(l.chamado_id).padStart(5, "0")}`, l.titulo, l.solicitante, l.usuario,
    l.descricao, hhmm(l.minutos), l.minutos, l.faturavel ? "sim" : "não",
  ].map(campo).join(";"));
  return `﻿${[cab.map(campo).join(";"), ...corpo].join("\r\n")}\r\n`;
}
