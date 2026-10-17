// Recortes da consulta de agenda (Card 16, RN01, RN02, RN05, RN08, RN16). Tudo puro: recebe "agora" por parametro e so faz
// conta de calendario ancorada em America/Sao_Paulo (spDateString/spDayOfWeek e datas puras, sem o Date local do servidor).
import { INVALID_MONTH_TEXT, monthLabel } from "../expenses/queryRange";
import { addDaysToDateString, clampToMonthEnd, daysInMonth, monthNamePt, spDateString, spDayOfWeek } from "../timeSP";

export type AgendaScope = "all" | "events" | "reminders";

export interface AgendaParams {
  days?: number;
  month?: string; // YYYY-MM
  date?: string; // YYYY-MM-DD (hoje, amanha, dia X, dia da semana: a IA resolve a data)
  week?: "current" | "next";
  scope?: AgendaScope;
}

export const DEFAULT_AGENDA_DAYS = 7;
export const MAX_AGENDA_DAYS = 365;

export const INVALID_AGENDA_DATE_TEXT = 'Não entendi essa data. Me diz o dia, ex: "agenda do dia 20" ou "agenda de amanhã".';

export interface AgendaRange {
  startIso: string; // inclusivo, com offset -03:00 (ou instante exato quando e "proximos N dias")
  endIso: string; // exclusivo
  startDate: string; // YYYY-MM-DD do primeiro dia do recorte (usado no agrupamento)
  label: string; // "hoje (qui 08/10)", "restante da semana (15/10 a 18/10)", "novembro/2026"...
  mode: "day" | "period";
  // consulta de periodo (semana, proximos dias) so mostra o que ainda vale; um dia e um mes mostram tudo (RN02)
  onlyUpcoming: boolean;
  scope: AgendaScope;
  notice?: string; // aviso antes da lista (dia inexistente, RN16)
}

export type AgendaRangeResult = { ok: true; range: AgendaRange } | { ok: false; error: string };

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const pad = (n: number) => String(n).padStart(2, "0");

const midnight = (date: string) => `${date}T00:00:00-03:00`;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// dia da semana ("qui") de uma data-calendario pura
export function weekdayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// "2026-10-08" -> "08/10"; com o ano quando nao e o ano de "today"
export function dayMonth(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

export function agendaTitlePrefix(scope: AgendaScope): string {
  if (scope === "events") return "📅 Eventos";
  if (scope === "reminders") return "⏰ Lembretes";
  return "📅 Agenda";
}

function dayLabel(date: string, today: string): string {
  const shown = `${weekdayShort(date)} ${dayMonth(date, today)}`;
  if (date === today) return `hoje (${shown})`;
  if (date === addDaysToDateString(today, 1)) return `amanhã (${shown})`;
  if (date === addDaysToDateString(today, -1)) return `ontem (${shown})`;
  return `dia ${dayMonth(date, today)} (${weekdayShort(date)})`;
}

// dia pedido que o mes nao tem (31/04, 30/02...) vira o ultimo dia do mes (RN16); dia 32, mes 13 e texto: null
function adjustMissingDay(date: string): { date: string; notice: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const last = daysInMonth(year, month);
  if (day <= last) return null;
  const adjusted = clampToMonthEnd(date, new Date(0)).iso;
  const name = monthNamePt(month);
  return { date: adjusted, notice: `${name.charAt(0).toUpperCase()}${name.slice(1)} só tem ${last} dias — mostrando o dia ${pad(last)}/${pad(month)}.` };
}

export function resolveAgendaRange(params: AgendaParams, now: Date = new Date()): AgendaRangeResult {
  const scope: AgendaScope = params.scope ?? "all";
  const today = spDateString(now);

  // ---- um dia (hoje, amanha, dia X, dia da semana) ----
  if (params.date) {
    let date = params.date.trim().slice(0, 10);
    let notice: string | undefined;
    if (!isCalendarDate(date)) {
      const adjusted = adjustMissingDay(date);
      if (!adjusted) return { ok: false, error: INVALID_AGENDA_DATE_TEXT };
      date = adjusted.date;
      notice = adjusted.notice;
    }
    return {
      ok: true,
      range: { startIso: midnight(date), endIso: midnight(addDaysToDateString(date, 1)), startDate: date, label: dayLabel(date, today), mode: "day", onlyUpcoming: false, scope, notice },
    };
  }

  // ---- semana do calendario (segunda a domingo) ----
  if (params.week) {
    const sinceMonday = (spDayOfWeek(now) + 6) % 7;
    const monday = addDaysToDateString(today, -sinceMonday);
    if (params.week === "next") {
      const start = addDaysToDateString(monday, 7);
      const end = addDaysToDateString(start, 7);
      return {
        ok: true,
        range: {
          startIso: midnight(start),
          endIso: midnight(end),
          startDate: start,
          label: `semana que vem (${dayMonth(start, today)} a ${dayMonth(addDaysToDateString(end, -1), today)})`,
          mode: "period",
          onlyUpcoming: true,
          scope,
        },
      };
    }
    const end = addDaysToDateString(monday, 7);
    const whole = sinceMonday === 0; // segunda: a semana inteira; nos outros dias, so o restante
    return {
      ok: true,
      range: {
        startIso: midnight(today),
        endIso: midnight(end),
        startDate: today,
        label: `${whole ? "semana" : "restante da semana"} (${dayMonth(today, today)} a ${dayMonth(addDaysToDateString(end, -1), today)})`,
        mode: "period",
        onlyUpcoming: true,
        scope,
      },
    };
  }

  // ---- mes nomeado: o mes inteiro (passado e atual mostram o historico, futuro mostra tudo) ----
  if (params.month) {
    const match = /^(\d{4})-(\d{2})$/.exec(params.month.trim());
    const month = match ? Number(match[2]) : 0;
    if (!match || month < 1 || month > 12) return { ok: false, error: INVALID_MONTH_TEXT };
    const yearMonth = `${match[1]}-${match[2]}`;
    const start = `${yearMonth}-01`;
    const end = month === 12 ? `${Number(match[1]) + 1}-01-01` : `${match[1]}-${pad(month + 1)}-01`;
    return {
      ok: true,
      range: { startIso: midnight(start), endIso: midnight(end), startDate: start, label: monthLabel(yearMonth), mode: "period", onlyUpcoming: false, scope },
    };
  }

  // ---- proximos N dias a partir de agora (padrao 7) ----
  const requested = params.days !== undefined && Number.isFinite(params.days) ? Math.floor(params.days) : DEFAULT_AGENDA_DAYS;
  const days = Math.min(Math.max(requested, 1), MAX_AGENDA_DAYS);
  return {
    ok: true,
    range: {
      startIso: now.toISOString(),
      endIso: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
      startDate: today,
      label: days === 1 ? "próximas 24 horas" : `próximos ${days} dias`,
      mode: "period",
      onlyUpcoming: true,
      scope,
    },
  };
}
