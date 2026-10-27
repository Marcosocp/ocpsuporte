// Cria um administrador da OCP pelo terminal (o primeiro acesso). Em produção o convite vai por e-mail;
// na instância de teste (e-mails em arquivo) o link aparece no terminal.
// Uso: npm run criar-admin -- "Nome Completo" email@ocp.com.br
import { pool } from "../src/db/conexao.js";
import { migrar } from "../src/db/migrar.js";
import { config } from "../src/config.js";
import { criarLinkConta, enviarConvite } from "../src/contas.js";
import { emailValido } from "../src/validacao.js";

const [nome, emailBruto] = process.argv.slice(2);
const email = (emailBruto ?? "").trim().toLowerCase();
if (!nome || !emailValido(email)) {
  console.error('Uso: npm run criar-admin -- "Nome Completo" email@ocp.com.br');
  process.exit(1);
}

try {
  await migrar();
  const [existe] = await pool.query<any[]>("SELECT id FROM usuarios WHERE email = ?", [email]);
  if (existe.length) throw new Error(`Já existe usuário com o e-mail ${email}`);
  const [r] = await pool.query<any>("INSERT INTO usuarios (papel, nome, email) VALUES ('admin', ?, ?)", [nome, email]);
  await pool.query("INSERT INTO auditoria (usuario_id, acao, detalhes) VALUES (NULL, 'usuario_criado', ?)",
    [JSON.stringify({ usuario_id: r.insertId, email, papel: "admin", via: "terminal" })]);
  console.log(`Administrador criado: ${email}`);
  if (config.emailModo === "smtp") {
    // Produção: o link vai só por e-mail (não fica no terminal nem no histórico).
    await enviarConvite(r.insertId);
    console.log("Convite enviado por e-mail (link válido por 7 dias, uso único).");
  } else {
    console.log(`Defina a senha neste link (vale 7 dias, uso único):\n${await criarLinkConta(r.insertId, "convite")}`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
