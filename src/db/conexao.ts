import mysql from "mysql2/promise";
import { config } from "../config.js";

export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  timezone: "Z",
  charset: "utf8mb4",
});

// Datas sempre em UTC, qualquer que seja o fuso do servidor MySQL (o da Hostinger pode não ser UTC).
pool.on("connection", (conexao) => {
  conexao.query("SET time_zone = '+00:00'");
});
