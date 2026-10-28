// Usuários de cliente e departamentos: usados pelo administrador (qualquer cliente) e pelo gestor (só a própria empresa).
import type { Request } from "express";
import { pool } from "./db/conexao.js";
import { registrar } from "./auditoria.js";
import { derrubarAcessos, enviarConvite } from "./contas.js";
import { emailValido, normalizarCelular } from "./validacao.js";
import { ids, texto } from "./formulario.js";

export class ErroCadastro extends Error {}

export async function departamentosDoCliente(clienteId: number, soAtivos = false): Promise<any[]> {
  const [linhas] = await pool.query<any[]>(
    `SELECT id, nome, ativo FROM departamentos WHERE cliente_id = ? ${soAtivos ? "AND ativo" : ""} ORDER BY nome`, [clienteId],
  );
  return linhas;
}

export async function usuariosDoCliente(clienteId: number): Promise<any[]> {
  const [usuarios] = await pool.query<any[]>(
    `SELECT u.id, u.nome, u.email, u.celular, u.papel, u.ativo, u.ultimo_login, u.senha_hash IS NOT NULL AS acesso_definido,
            GROUP_CONCAT(d.id) AS departamento_ids, GROUP_CONCAT(d.nome ORDER BY d.nome SEPARATOR ', ') AS departamentos
     FROM usuarios u LEFT JOIN usuario_departamentos ud ON ud.usuario_id = u.id LEFT JOIN departamentos d ON d.id = ud.departamento_id
     WHERE u.cliente_id = ? GROUP BY u.id ORDER BY u.ativo DESC, u.nome`,
    [clienteId],
  );
  for (const u of usuarios) u.departamento_ids = u.departamento_ids ? String(u.departamento_ids).split(",").map(Number) : [];
  return usuarios;
}

// Só aceita departamentos do próprio cliente (nunca de outro).
export async function departamentosValidos(clienteId: number, valor: unknown): Promise<number[]> {
  const pedidos = ids(valor);
  if (!pedidos.length) return [];
  const [linhas] = await pool.query<any[]>("SELECT id FROM departamentos WHERE cliente_id = ? AND id IN (?)", [clienteId, pedidos]);
  if (linhas.length !== pedidos.length) throw new ErroCadastro("Departamento inválido.");
  return pedidos;
}

async function gravarDepartamentos(usuarioId: number, departamentos: number[]): Promise<void> {
  await pool.query("DELETE FROM usuario_departamentos WHERE usuario_id = ?", [usuarioId]);
  if (departamentos.length) {
    await pool.query("INSERT INTO usuario_departamentos (usuario_id, departamento_id) VALUES ?", [departamentos.map((d) => [usuarioId, d])]);
  }
}

export function dadosPessoa(body: any) {
  const nome = texto(body.nome, 150);
  const email = texto(body.email, 190).toLowerCase();
  const celularBruto = texto(body.celular, 30);
  const celular = celularBruto ? normalizarCelular(celularBruto) : null;
  if (!nome || !emailValido(email)) throw new ErroCadastro("Informe nome e e-mail válidos.");
  if (celularBruto && !celular) throw new ErroCadastro("Celular inválido. Use DDD + número.");
  return { nome, email, celular };
}

/** Manda o convite; se o e-mail falhar, o usuário continua criado e o convite pode ser reenviado. */
export async function convidar(usuarioId: number): Promise<boolean> {
  try {
    await enviarConvite(usuarioId);
    return true;
  } catch (e) {
    console.error("Falha ao enviar convite:", (e as Error).message);
    return false;
  }
}

/** Cria usuário de cliente e manda o convite por e-mail (ele mesmo define a senha). Devolve se o convite saiu. */
export async function criarUsuarioCliente(req: Request, clienteId: number, body: any): Promise<boolean> {
  const { nome, email, celular } = dadosPessoa(body);
  const papel = body.papel === "gestor" ? "gestor" : "usuario";
  const departamentos = await departamentosValidos(clienteId, body.departamentos);
  const [existe] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ?", [email]);
  if (existe.length) throw new ErroCadastro("Já existe um usuário com esse e-mail.");

  const [r] = await pool.query<any>(
    "INSERT INTO usuarios (cliente_id, papel, nome, email, celular) VALUES (?, ?, ?, ?, ?)", [clienteId, papel, nome, email, celular],
  );
  await gravarDepartamentos(r.insertId, departamentos);
  await registrar(req, "usuario_criado", { usuario_id: r.insertId, cliente_id: clienteId, email, papel });
  return convidar(r.insertId);
}

/** Atualiza papel, celular, departamentos e situação. Quem edita não pode se rebaixar nem se desativar. */
export async function atualizarUsuarioCliente(req: Request, clienteId: number, usuarioId: number, body: any): Promise<void> {
  const [linhas] = await pool.query<any[]>("SELECT * FROM usuarios WHERE id = ? AND cliente_id = ?", [usuarioId, clienteId]);
  const alvo = linhas[0];
  if (!alvo) throw new ErroCadastro("Usuário não encontrado.");
  const { nome, celular } = dadosPessoa({ ...body, email: alvo.email });
  const papel = body.papel === "gestor" ? "gestor" : "usuario";
  const ativo = body.ativo === "1";
  if (usuarioId === req.session.usuario!.id && (papel !== alvo.papel || !ativo)) {
    throw new ErroCadastro("Você não pode mudar o próprio perfil nem se desativar.");
  }
  const departamentos = await departamentosValidos(clienteId, body.departamentos);
  await pool.query("UPDATE usuarios SET nome = ?, celular = ?, papel = ?, ativo = ? WHERE id = ?", [nome, celular, papel, ativo, usuarioId]);
  await gravarDepartamentos(usuarioId, departamentos);
  if (!ativo || papel !== alvo.papel) await derrubarAcessos([usuarioId]);
  await registrar(req, "usuario_alterado", { usuario_id: usuarioId, cliente_id: clienteId, papel, ativo, departamentos });
}

export async function reenviarConvite(req: Request, clienteId: number | null, usuarioId: number): Promise<void> {
  const [linhas] = await pool.query<any[]>(
    "SELECT id FROM usuarios WHERE id = ? AND ativo AND senha_hash IS NULL AND cliente_id <=> ?", [usuarioId, clienteId],
  );
  if (!linhas.length) throw new ErroCadastro("Esse usuário já definiu a senha ou está inativo.");
  if (!(await convidar(usuarioId))) throw new ErroCadastro("Não foi possível enviar o e-mail agora. Tente de novo em instantes.");
  await registrar(req, "convite_reenviado", { usuario_id: usuarioId });
}

export async function criarDepartamento(req: Request, clienteId: number, body: any): Promise<void> {
  const nome = texto(body.nome, 100);
  if (!nome) throw new ErroCadastro("Informe o nome do departamento.");
  const [existe] = await pool.query<any[]>("SELECT id FROM departamentos WHERE cliente_id = ? AND nome = ?", [clienteId, nome]);
  if (existe.length) throw new ErroCadastro("Esse departamento já existe.");
  await pool.query("INSERT INTO departamentos (cliente_id, nome) VALUES (?, ?)", [clienteId, nome]);
  await registrar(req, "departamento_criado", { cliente_id: clienteId, nome });
}

export async function atualizarDepartamento(req: Request, clienteId: number, departamentoId: number, body: any): Promise<void> {
  const nome = texto(body.nome, 100);
  if (!nome) throw new ErroCadastro("Informe o nome do departamento.");
  const [r] = await pool.query<any>(
    "UPDATE departamentos SET nome = ?, ativo = ? WHERE id = ? AND cliente_id = ?", [nome, body.ativo === "1", departamentoId, clienteId],
  ).catch((e) => {
    if (e.code === "ER_DUP_ENTRY") throw new ErroCadastro("Já existe um departamento com esse nome.");
    throw e;
  });
  if (!r.affectedRows) throw new ErroCadastro("Departamento não encontrado.");
  await registrar(req, "departamento_alterado", { cliente_id: clienteId, departamento_id: departamentoId, nome, ativo: body.ativo === "1" });
}
