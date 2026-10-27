import type { Request } from "express";
import { pool } from "./db/conexao.js";

// IPv4 que chega como IPv6 mapeado (::ffff:1.2.3.4) é gravado na forma comum.
export const ipLegivel = (ip: string | undefined | null) => (ip ? ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "") : null);

// chamado_id em "detalhes" também vai para coluna própria (histórico do chamado).
// req pode ser null em tarefas automáticas (sem IP/navegador).
export async function registrar(
  req: Request | null,
  acao: string,
  detalhes: Record<string, unknown> = {},
  usuarioId: number | null = req?.session.usuario?.id ?? null,
): Promise<void> {
  await pool.query(
    "INSERT INTO auditoria (usuario_id, chamado_id, acao, ip, user_agent, detalhes) VALUES (?, ?, ?, ?, ?, ?)",
    [usuarioId, detalhes.chamado_id ?? null, acao,
      ipLegivel(req?.ip), req ? (req.get("user-agent") ?? "").slice(0, 500) : null, JSON.stringify(detalhes)],
  );
}
