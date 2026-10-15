// Periodos das consultas de gastos e entradas (Card 14). Tudo puro e ancorado em America/Sao_Paulo: "hoje" vem de
// spDateString e as contas sao de calendario (sem Date local do servidor), entao um container em UTC nao muda o
// resultado perto da virada do dia (22h em Sao Paulo ja e "amanha" em UTC).
import { addDaysToDateString, spDateString } from "../timeSP";

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusivo
  end: string; // YYYY-MM-DD, exclusivo
  label: string;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const MAX_RANGE_DAYS = 366;

export const INVALID_RANGE_TEXT = 'Esse período não dá certo. Me diz um intervalo de até 1 ano, ex: "de 10/09 a 20/09".';
export const INVALID_MONTH_TEXT = 'Não entendi esse mês. Me diz de novo, ex: "gastos de setembro".';

const pad = (n: number) => String(n).padStart(2, "0");

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function daysBetween(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86400000);
}

function firstOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

function firstOfNextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

// "2026-09" -> "setembro/2026"
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]}/${y}`;
}

// "2026-10" -> "outubro de 2026" (rotulo dos relatorios de "esse mes" / "mes passado")
function monthLongLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

// "2026-10-08" -> "08/10"; com o ano quando nao e o ano de "today"
function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// periodos nomeados (os mesmos de sempre, agora no fuso de Sao Paulo)
// ---------------------------------------------------------------------------

// "essa semana" = ultimos 7 dias, incluindo hoje (NAO e a semana do calendario)
export function currentWeekRange(today: string = spDateString()): DateRange {
  const end = addDaysToDateString(today, 1);
  return { start: addDaysToDateString(end, -7), end, label: "essa semana" };
}

export function previousWeekRange(today: string = spDateString()): DateRange {
  return { start: addDaysToDateString(today, -7), end: today, label: "semana passada" };
}

export function currentMonthRange(today: string = spDateString()): DateRange {
  const ym = today.slice(0, 7);
  return { start: firstOfMonth(ym), end: firstOfNextMonth(ym), label: `esse mês (${monthLongLabel(ym)})` };
}

export function previousMonthRange(today: string = spDateString()): DateRange {
  const ym = today.slice(0, 7);
  const prev = addDaysToDateString(firstOfMonth(ym), -1).slice(0, 7);
  return { start: firstOfMonth(prev), end: firstOfMonth(ym), label: monthLongLabel(prev) };
}

// "ultimos N dias", incluindo hoje
export function lastNDaysRange(days: number, today: string = spDateString()): DateRange {
  const end = addDaysToDateString(today, 1);
  return { start: addDaysToDateString(end, -days), end, label: `últimos ${days} dias` };
}

// um dia especifico, dateStr = "YYYY-MM-DD"
export function singleDayRange(dateStr: string, label: string): DateRange {
  return { start: dateStr, end: addDaysToDateString(dateStr, 1), label };
}

// "hoje" / "ontem" / dd/MM (dd/MM/aaaa em outro ano)
export function relativeDayLabel(date: string, today: string = spDateString()): string {
  const day = date.slice(0, 10);
  if (day === today) return "hoje";
  if (day === addDaysToDateString(today, -1)) return "ontem";
  return shortDate(day, today);
}

// ---------------------------------------------------------------------------
// resolucao dos campos de periodo da IA (RN06 a RN08)
// ---------------------------------------------------------------------------

export interface RangeParams {
  date_start?: string;
  date_end?: string;
  month?: string;
  date?: string;
  days?: number;
  period?: "week" | "month";
}

// de onde veio o periodo (a lista de gastos pergunta "resumo ou detalhado?" so quando veio de "days")
export type RangeSource = "interval" | "month" | "date" | "days" | "period";

export type RangeResult = { ok: true; range: DateRange | null; source: RangeSource | null } | { ok: false; error: string };

// prioridade (RN08): intervalo > mes > dia > ultimos N dias > semana/mes atual. Sem nada: range = null
// (quem chama decide o padrao).
export function resolveQueryRange(params: RangeParams, today: string = spDateString()): RangeResult {
  const hasInterval = Boolean(params.date_start && params.date_end);
  if (hasInterval) {
    const start = params.date_start!.slice(0, 10);
    const end = params.date_end!.slice(0, 10);
    if (!isCalendarDate(start) || !isCalendarDate(end)) return { ok: false, error: INVALID_RANGE_TEXT };
    const length = daysBetween(start, end) + 1; // inclusivo nos dois lados
    if (length < 1 || length > MAX_RANGE_DAYS) return { ok: false, error: INVALID_RANGE_TEXT };
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    const label =
      sameYear && start.slice(0, 4) === today.slice(0, 4)
        ? `${shortDate(start, today)} a ${shortDate(end, today)}`
        : `${shortDate(start, "0000-00-00")} a ${shortDate(end, "0000-00-00")}`;
    return { ok: true, source: "interval", range: { start, end: addDaysToDateString(end, 1), label } };
  }

  if (params.month) {
    const month = params.month.trim().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: INVALID_MONTH_TEXT };
    return { ok: true, source: "month", range: { start: firstOfMonth(month), end: firstOfNextMonth(month), label: monthLabel(month) } };
  }

  if (params.date) {
    const day = params.date.slice(0, 10);
    if (!isCalendarDate(day)) return { ok: false, error: INVALID_RANGE_TEXT };
    const [y, m, d] = day.split("-");
    const label = relativeDayLabel(day, today);
    return { ok: true, source: "date", range: singleDayRange(day, label === shortDate(day, today) ? `${d}/${m}/${y}` : label) };
  }

  if (typeof params.days === "number" && Number.isFinite(params.days) && params.days >= 1) {
    const days = Math.min(Math.floor(params.days), MAX_RANGE_DAYS);
    return { ok: true, source: "days", range: days === 1 ? singleDayRange(today, "hoje") : lastNDaysRange(days, today) };
  }

  if (params.period === "week") return { ok: true, source: "period", range: currentWeekRange(today) };
  if (params.period === "month") return { ok: true, source: "period", range: currentMonthRange(today) };
  return { ok: true, source: null, range: null };
}
