// Aplica, em ordem, os arquivos migracoes/NNN-*.sql que ainda não rodaram.
// Roda sozinho no início do servidor e também via `npm run migrar`.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./conexao.js";

const pasta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migracoes");

export async function migrar(): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migracoes (
    nome VARCHAR(200) PRIMARY KEY,
    aplicada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const [linhas] = await pool.query<any[]>("SELECT nome FROM _migracoes");
  const feitas = new Set(linhas.map((l) => l.nome));
  const arquivos = (await readdir(pasta)).filter((a) => a.endsWith(".sql")).sort();

  const aplicadas: string[] = [];
  for (const arquivo of arquivos) {
    if (feitas.has(arquivo)) continue;
    const sql = await readFile(path.join(pasta, arquivo), "utf8");
    // MySQL faz commit implícito em DDL, então cada comando roda separado;
    // por isso as migrações devem ser idempotentes (IF NOT EXISTS).
    for (const comando of sql.split(/;\s*$/m).map((c) => c.trim()).filter(Boolean)) {
      await pool.query(comando);
    }
    await pool.query("INSERT INTO _migracoes (nome) VALUES (?)", [arquivo]);
    aplicadas.push(arquivo);
  }
  return aplicadas;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrar()
    .then((a) => console.log(a.length ? `Aplicadas: ${a.join(", ")}` : "Banco já atualizado"))
    .finally(() => pool.end());
}
