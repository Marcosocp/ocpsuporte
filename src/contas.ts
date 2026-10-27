// Convites, links de senha e derrubada de acessos. Usado pelo painel, pelo portal (gestor) e pelo terminal.
import { pool } from "./db/conexao.js";
import { config } from "./config.js";
import { enviarEmail } from "./email.js";
import { convite, redefinirSenha } from "./modelos-email.js";
import { hashToken, novoToken } from "./tokens.js";

const VALIDADE = { convite: 7 * 24 * 60, senha: 60 }; // minutos

/** Cria um link de uso único (os anteriores do mesmo tipo deixam de valer) e devolve o endereço. */
export async function criarLinkConta(usuarioId: number, tipo: "convite" | "senha"): Promise<string> {
  const token = novoToken();
  await pool.query("UPDATE links_conta SET usado_em = UTC_TIMESTAMP() WHERE usuario_id = ? AND tipo = ? AND usado_em IS NULL", [usuarioId, tipo]);
  await pool.query(
    "INSERT INTO links_conta (usuario_id, tipo, token_hash, expira_em) VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE)",
    [usuarioId, tipo, hashToken(token), VALIDADE[tipo]],
  );
  return `${config.baseUrl}/conta/definir/${token}`;
}

export async function enviarConvite(usuarioId: number): Promise<void> {
  const [linhas] = await pool.query<any[]>(
    "SELECT u.nome, u.email, c.nome AS empresa FROM usuarios u LEFT JOIN clientes c ON c.id = u.cliente_id WHERE u.id = ?",
    [usuarioId],
  );
  const u = linhas[0];
  await enviarEmail(convite(u, await criarLinkConta(usuarioId, "convite"), u.empresa));
}

export async function enviarRedefinicao(usuarioId: number): Promise<void> {
  const [linhas] = await pool.query<any[]>("SELECT nome, email FROM usuarios WHERE id = ?", [usuarioId]);
  await enviarEmail(redefinirSenha(linhas[0], await criarLinkConta(usuarioId, "senha")));
}

/** Derruba sessões abertas e navegadores confiáveis (usuário desativado ou senha trocada). */
export async function derrubarAcessos(usuarioIds: number[]): Promise<void> {
  if (!usuarioIds.length) return;
  await pool.query("DELETE FROM sessoes WHERE CAST(JSON_EXTRACT(data, '$.usuario.id') AS UNSIGNED) IN (?)", [usuarioIds]);
  await pool.query("DELETE FROM navegadores_confiaveis WHERE usuario_id IN (?)", [usuarioIds]);
}
