// Calendário de horário útil: seg–sex, 08h–18h no horário de Brasília, sem feriados.
// O Brasil não tem horário de verão desde 2019, então Brasília é sempre UTC−3.
// Funções puras (sem banco): os feriados chegam como parâmetro.

export const ABRE = 8;
export const FECHA = 18;
const FUSO_MS = -3 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;

export type Feriados = ReadonlySet<string>; // "AAAA-MM-DD"

// Trabalhamos com "instantes locais": o relógio de Brasília representado como se fosse UTC.
const paraLocal = (d: Date) => d.getTime() + FUSO_MS;
const deLocal = (ms: number) => new Date(ms - FUSO_MS);
const inicioDoDia = (ms: number) => Math.floor(ms / DIA) * DIA;
const chaveDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function diaUtil(diaMs: number, feriados: Feriados): boolean {
  const semana = new Date(diaMs).getUTCDay();
  return semana >= 1 && semana <= 5 && !feriados.has(chaveDia(diaMs));
}

/** Minutos úteis entre dois instantes (0 se fim <= inicio). */
export function minutosUteis(inicio: Date, fim: Date, feriados: Feriados): number {
  const a = paraLocal(inicio);
  const b = paraLocal(fim);
  if (b <= a) return 0;
  let total = 0;
  for (let dia = inicioDoDia(a); dia < b; dia += DIA) {
    if (!diaUtil(dia, feriados)) continue;
    const abre = Math.max(a, dia + ABRE * 60 * MIN);
    const fecha = Math.min(b, dia + FECHA * 60 * MIN);
    if (fecha > abre) total += fecha - abre;
  }
  return Math.floor(total / MIN);
}

/** O instante em que se completam N minutos úteis a partir de "inicio". */
export function somarMinutosUteis(inicio: Date, minutos: number, feriados: Feriados): Date {
  let resta = minutos * MIN;
  const a = paraLocal(inicio);
  for (let dia = inicioDoDia(a), voltas = 0; voltas < 3660; dia += DIA, voltas++) {
    if (!diaUtil(dia, feriados)) continue;
    const abre = Math.max(a, dia + ABRE * 60 * MIN);
    const fecha = dia + FECHA * 60 * MIN;
    if (fecha <= abre) continue;
    if (resta <= fecha - abre) return deLocal(abre + resta);
    resta -= fecha - abre;
  }
  throw new Error("Prazo além de 10 anos");
}

/** "2h30", "1 dia e 2h" — duração útil legível (1 dia útil = 10 h). */
export function duracaoUtil(minutos: number): string {
  const horasDia = FECHA - ABRE;
  const dias = Math.floor(minutos / (horasDia * 60));
  const resto = minutos - dias * horasDia * 60;
  const h = Math.floor(resto / 60);
  const m = resto % 60;
  const partes = [];
  if (dias) partes.push(`${dias} dia${dias > 1 ? "s" : ""}`);
  if (h || (!dias && !m)) partes.push(m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`);
  else if (m) partes.push(`${m} min`);
  return partes.join(" e ");
}

/** Mês local (Brasília) "AAAA-MM" de um instante. */
export const mesLocal = (d: Date) => new Date(paraLocal(d)).toISOString().slice(0, 7);
/** Data local (Brasília) "AAAA-MM-DD" de um instante. */
export const dataLocal = (d: Date) => new Date(paraLocal(d)).toISOString().slice(0, 10);
