// Calendário útil (seg–sex 8h–18h, Brasília, feriados). Rodar: npx tsx testes/expediente.test.ts
import { minutosUteis, somarMinutosUteis, duracaoUtil, mesLocal, dataLocal } from "../src/expediente.js";
const F = new Set(["2026-11-02"]);
let falhas = 0;
const igual = (obtido: unknown, esperado: unknown, nome: string) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✔" : "✘"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const z = (s: string) => new Date(s);
igual(somarMinutosUteis(z("2026-10-26T12:00:00Z"), 60, F).toISOString(), "2026-10-26T13:00:00.000Z", "seg 09:00 + 1h = 10:00");
igual(somarMinutosUteis(z("2026-10-30T20:30:00Z"), 60, F).toISOString(), "2026-11-03T11:30:00.000Z", "sex 17:30 + 1h pula fim de semana e Finados → ter 08:30");
igual(minutosUteis(z("2026-10-30T20:30:00Z"), z("2026-11-03T11:30:00Z"), F), 60, "sex 17:30 → ter 08:30 = 60 min úteis");
igual(somarMinutosUteis(z("2026-10-31T13:00:00Z"), 30, F).toISOString(), "2026-11-03T11:30:00.000Z", "sábado + 30 min → ter 08:30 (seg é feriado)");
igual(somarMinutosUteis(z("2026-10-27T10:00:00Z"), 10, F).toISOString(), "2026-10-27T11:10:00.000Z", "ter 07:00 + 10 min → 08:10");
igual(somarMinutosUteis(z("2026-10-26T17:00:00Z"), 600, F).toISOString(), "2026-10-27T17:00:00.000Z", "seg 14:00 + 1 dia útil → ter 14:00");
igual(somarMinutosUteis(z("2026-10-26T21:00:00Z"), 60, F).toISOString(), "2026-10-27T12:00:00.000Z", "seg 18:00 (fechado) + 1h → ter 09:00");
igual(minutosUteis(z("2026-10-26T11:00:00Z"), z("2026-10-26T21:00:00Z"), F), 600, "dia inteiro = 600");
igual(minutosUteis(z("2026-10-26T22:00:00Z"), z("2026-10-27T10:59:00Z"), F), 0, "noite = 0");
igual(duracaoUtil(150), "2h30", "150 min = 2h30");
igual(duracaoUtil(660), "1 dia e 1h", "660 min = 1 dia e 1h");
igual(duracaoUtil(45), "45 min", "45 min");
igual(duracaoUtil(1800), "3 dias", "1800 min = 3 dias");
igual(mesLocal(z("2026-11-01T02:00:00Z")), "2026-10", "01/11 02:00Z ainda é outubro em Brasília");
igual(dataLocal(z("2026-10-28T02:30:00Z")), "2026-10-27", "data local");
process.exit(falhas ? 1 : 0);
