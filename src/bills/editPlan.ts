// Edicao guiada de conta fixa / alerta de conta (Card 15, RN07 a RN09). Puro, sem banco e sem I/O: calcula a
// proposta "depois" a partir do pedido, valida (dia 1 a 31, intervalo 1 a 3650, proximo aviso de hoje em diante)
// e monta as linhas "antes → depois" da previa 1/2/3.
import { formatShortDate } from "../confirmation/preview";
import { addDaysToDateString } from "../timeSP";
import type { BillRecurrence } from "./checkinReply";

export const MAX_BILL_INTERVAL_DAYS = 3650;
export const MAX_BILL_NAME_LENGTH = 100;

export const BILL_DAY_RANGE_TEXT = "O dia do mês precisa ser um número de 1 a 31.";
export const BILL_INTERVAL_RANGE_TEXT = `O intervalo precisa ser um número de dias entre 1 e ${MAX_BILL_INTERVAL_DAYS}.`;
export const BILL_NEXT_DATE_TEXT = "A data precisa ser de hoje em diante.";
export const BILL_DUPLICATE_WARNING = "⚠️ Você já tem um alerta com esse nome";

// o que de um alerta pode mudar na edicao
export interface BillParams {
  name: string;
  recurrenceType: BillRecurrence;
  dayOfMonth: number | null;
  intervalDays: number | null;
  nextDueDate: string | null;
}

export interface BillChangeRequest {
  name?: string;
  dayOfMonth?: number;
  intervalDays?: number;
  nextDueDate?: string;
}

export type BillChangeKey = "name" | "recurrence" | "next_due";

export interface BillChange {
  key: BillChangeKey;
  label: string;
  from: string;
  to: string;
}

// "todo dia 5" / "a cada 45 dias"
export function recurrenceText(params: Pick<BillParams, "recurrenceType" | "dayOfMonth" | "intervalDays">): string {
  return params.recurrenceType === "interval" ? `a cada ${params.intervalDays} dias` : `todo dia ${params.dayOfMonth}`;
}

export type ApplyBillResult = { ok: true; proposed: BillParams } | { ok: false; error: string };

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// aplica o pedido sobre o estado ATUAL (sem gravar nada). Trocar a recorrencia converte o tipo; o intervalo recomeca
// a contar de hoje, a nao ser que o usuario tenha dito o proximo aviso.
export function applyBillChanges(previous: BillParams, request: BillChangeRequest, today: string): ApplyBillResult {
  const proposed: BillParams = { ...previous };

  if (request.name !== undefined) {
    const name = request.name.trim().replace(/\s+/g, " ");
    if (name.length > MAX_BILL_NAME_LENGTH) return { ok: false, error: `Esse nome está muito longo (máximo ${MAX_BILL_NAME_LENGTH} caracteres).` };
    if (name) proposed.name = name;
  }

  const { dayOfMonth, intervalDays, nextDueDate } = request;
  if (dayOfMonth !== undefined && intervalDays !== undefined) return { ok: false, error: "Escolhe um só: dia do mês ou intervalo de dias." };
  if (dayOfMonth !== undefined && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) return { ok: false, error: BILL_DAY_RANGE_TEXT };
  if (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > MAX_BILL_INTERVAL_DAYS)) {
    return { ok: false, error: BILL_INTERVAL_RANGE_TEXT };
  }
  if (nextDueDate !== undefined) {
    if (!isCalendarDate(nextDueDate)) return { ok: false, error: "Não entendi essa data. Me manda o dia, ex: 15/11." };
    if (nextDueDate < today) return { ok: false, error: BILL_NEXT_DATE_TEXT };
  }

  if (dayOfMonth !== undefined) {
    proposed.recurrenceType = "day_of_month";
    proposed.dayOfMonth = dayOfMonth;
    proposed.intervalDays = null;
    proposed.nextDueDate = null;
  } else if (intervalDays !== undefined) {
    proposed.recurrenceType = "interval";
    proposed.intervalDays = intervalDays;
    proposed.nextDueDate = nextDueDate ?? addDaysToDateString(today, intervalDays);
  } else if (nextDueDate !== undefined) {
    if (proposed.recurrenceType !== "interval") return { ok: false, error: "Só os alertas por intervalo têm próximo aviso. Pra esse, mude o dia do mês." };
    proposed.nextDueDate = nextDueDate;
  }
  return { ok: true, proposed };
}

// as linhas da previa: so o que mudou (Nome, Recorrencia, Proximo aviso)
export function billChanges(previous: BillParams, proposed: BillParams): BillChange[] {
  const changes: BillChange[] = [];
  if (proposed.name !== previous.name) changes.push({ key: "name", label: "Nome", from: previous.name, to: proposed.name });
  // a recorrencia mudou quando o texto muda ("todo dia 5" -> "todo dia 8", "todo dia 5" -> "a cada 45 dias")
  if (recurrenceText(previous) !== recurrenceText(proposed)) {
    changes.push({ key: "recurrence", label: "Recorrência", from: recurrenceText(previous), to: recurrenceText(proposed) });
  }
  if (proposed.recurrenceType === "interval" && proposed.nextDueDate !== previous.nextDueDate) {
    changes.push({
      key: "next_due",
      label: "Próximo aviso",
      from: previous.nextDueDate ? formatShortDate(previous.nextDueDate) : "—",
      to: proposed.nextDueDate ? formatShortDate(proposed.nextDueDate) : "—",
    });
  }
  return changes;
}

// o pedido pode vir da IA (new_name, day_of_month, interval_days, next_due_date) ou do menu
export function hasBillChangeRequest(request: BillChangeRequest): boolean {
  return Boolean(request.name?.trim()) || request.dayOfMonth !== undefined || request.intervalDays !== undefined || request.nextDueDate !== undefined;
}

// "dia 20" e "15/11" (sem ano) no proximo aviso valem a PROXIMA vez que a data chega (hoje conta), nao a passada que o
// campo de data de gasto devolveria. Outros formatos: null (quem chama usa o leitor de datas normal).
export function nextOccurrenceDate(text: string, today: string): string | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;]+$/g, "");
  const [year, month] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  const dayOnly = /^(?:dia\s+)?(\d{1,2})$/.exec(t);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    if (day < 1 || day > 31) return null;
    for (let step = 0; step < 13; step++) {
      const total = year * 12 + (month - 1) + step;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (day > lastDay(y, m)) continue;
      const iso = `${y}-${pad(m)}-${pad(day)}`;
      if (iso >= today) return iso;
    }
    return null;
  }
  const dm = /^(\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (dm) {
    const day = Number(dm[1]);
    const m = Number(dm[2]);
    if (m < 1 || m > 12 || day < 1) return null;
    for (const y of [year, year + 1]) {
      if (day > lastDay(y, m)) continue;
      const iso = `${y}-${pad(m)}-${pad(day)}`;
      if (iso >= today) return iso;
    }
  }
  return null;
}

// "Água — todo dia 5" / "Ração — a cada 45 dias · próximo aviso 15/11" (linha da lista numerada e cabecalho do menu)
export function billAlertLine(params: BillParams): string {
  const next = params.recurrenceType === "interval" && params.nextDueDate ? ` · próximo aviso ${formatShortDate(params.nextDueDate)}` : "";
  return `${params.name} — ${recurrenceText(params)}${next}`;
}
