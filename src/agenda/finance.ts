// Agenda financeira (Card 22, RN01 a RN09): o que vai ser cobrado de hoje em diante -- gastos fixos que lancam sozinhos, contas fixas
// (alertas), parcelas e lancamentos de data futura -- mais o que ficou em aberto. So leitura: nada aqui grava, avisa ou muda estado.
import { db } from "../db";
import { BILL_MAX_UNANSWERED_ASKS, getLastBillAlertAmount, lastBillDueDate, unansweredAsksInCycle, type BillAlert } from "../bills/service";
import { getMissedRecurringExpenses, listRecurringExpenses } from "../expenses/recurring";
import { addDaysToDateString, effectiveDayOfMonth, spDateString, sqliteUtcToSpDate } from "../timeSP";
import type { AgendaRange } from "./range";

export const MAX_FINANCE_ITEMS = 30;

export type FinanceItemKind = "recurring" | "bill" | "installment" | "future";

export interface FinanceItem {
  date: string; // YYYY-MM-DD
  kind: FinanceItemKind;
  name: string;
  amount: number | null; // null = valor a informar
  amountIsLast: boolean; // conta fixa: o valor e o ultimo lancado (estimativa)
  recurrence?: string; // "a cada 45 dias" (conta por intervalo)
  installment?: { number: number; total: number };
}

export type OpenItemKind = "bill" | "recurring";

export interface OpenItem {
  kind: OpenItemKind;
  name: string;
  dueDate: string;
  amount: number | null; // so o gasto fixo atrasado (ainda nao lancado) mostra o valor
  asks: number; // avisos sem resposta no ciclo (conta fixa)
  maxAsks: number;
}

export interface FinanceAgenda {
  openItems: OpenItem[];
  items: FinanceItem[]; // so os que cabem (ate MAX_FINANCE_ITEMS)
  hiddenCount: number;
  total: number; // soma de TODOS os itens com valor, inclusive os escondidos
  withoutValue: number; // quantos itens (todos) ficaram sem valor definido
}

const KIND_ORDER: Record<FinanceItemKind, number> = { recurring: 0, bill: 1, installment: 2, future: 2 };

const INSTALLMENT_SUFFIX = /^(.*) \(parcela (\d+)\/(\d+)\)$/;

// "Tenis (parcela 3/6)" -> { name: "Tenis", number: 3, total: 6 }; sufixo ausente ou malformado -> null (e um lancamento futuro comum)
export function parseInstallmentLabel(description: string): { name: string; number: number; total: number } | null {
  const match = INSTALLMENT_SUFFIX.exec(description.trim());
  if (!match) return null;
  const number = Number(match[2]);
  const total = Number(match[3]);
  if (!match[1].trim() || number < 1 || total < 1 || number > total) return null;
  return { name: match[1].trim(), number, total };
}

// os "YYYY-MM" que o recorte [startDate, endDate) toca
export function monthsInRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const last = addDaysToDateString(endDate, -1).slice(0, 7);
  let month = startDate.slice(0, 7);
  while (month <= last && months.length < 14) {
    months.push(month);
    const [y, m] = month.split("-").map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return months;
}

// data do vencimento de "todo dia N" no mes (dia 31 em mes de 30 dias cai no ultimo dia)
export function dueDateInMonth(dayOfMonth: number, yearMonth: string): string {
  return `${yearMonth}-${String(effectiveDayOfMonth(dayOfMonth, yearMonth)).padStart(2, "0")}`;
}

interface FutureExpenseRow {
  description: string;
  amount: number;
  date: string;
}

function recurringItems(fromNumber: string, startDate: string, endDate: string, today: string): FinanceItem[] {
  const todayMonth = today.slice(0, 7);
  const items: FinanceItem[] = [];
  for (const recurring of listRecurringExpenses(fromNumber)) {
    for (const month of monthsInRange(startDate, endDate)) {
      const date = dueDateInMonth(recurring.day_of_month, month);
      if (date < startDate || date >= endDate) continue;
      if (month === todayMonth && recurring.last_run_month === month) continue; // este mes ja foi lancado
      items.push({ date, kind: "recurring", name: recurring.description, amount: recurring.amount, amountIsLast: false });
    }
  }
  return items;
}

function billItems(bills: BillAlert[], fromNumber: string, startDate: string, endDate: string, today: string): FinanceItem[] {
  const items: FinanceItem[] = [];
  for (const bill of bills) {
    // o ultimo valor so e consultado quando o alerta realmente entra no recorte
    const base = () => {
      const lastAmount = getLastBillAlertAmount(fromNumber, bill.id);
      return { kind: "bill" as const, name: bill.name, amount: lastAmount, amountIsLast: lastAmount !== null };
    };
    if (bill.recurrence_type === "interval") {
      // so a proxima data: depois da confirmacao a contagem reinicia, entao as seguintes nao se projetam (RN04)
      if (bill.next_due_date && bill.next_due_date >= startDate && bill.next_due_date < endDate && bill.next_due_date >= today) {
        items.push({ ...base(), date: bill.next_due_date, recurrence: `a cada ${bill.interval_days} dias` });
      }
      continue;
    }
    for (const month of monthsInRange(startDate, endDate)) {
      const date = dueDateInMonth(bill.day_of_month, month);
      if (date < startDate || date >= endDate) continue;
      if (bill.confirmed_month === month) continue; // o ciclo deste mes ja foi resolvido
      items.push({ ...base(), date });
    }
  }
  return items;
}

function futureExpenseItems(fromNumber: string, startDate: string, endDate: string, today: string): FinanceItem[] {
  const rows = db
    .prepare(`SELECT description, amount, date FROM expenses WHERE from_number = ? AND date > ? AND date >= ? AND date < ? ORDER BY date ASC, id ASC`)
    .all(fromNumber, today, startDate, endDate) as unknown as FutureExpenseRow[];
  return rows.map((row) => {
    const parsed = parseInstallmentLabel(row.description);
    return parsed
      ? { date: row.date, kind: "installment" as const, name: parsed.name, amount: row.amount, amountIsLast: false, installment: { number: parsed.number, total: parsed.total } }
      : { date: row.date, kind: "future" as const, name: row.description, amount: row.amount, amountIsLast: false };
  });
}

// "Em aberto" (RN06): contas fixas cujo ciclo ja comecou sem resposta + gasto fixo recente que o servidor ainda nao lancou (Card 19)
function openItemsFor(bills: BillAlert[], fromNumber: string, today: string): OpenItem[] {
  const open: OpenItem[] = [];
  for (const bill of bills) {
    if (bill.recurrence_type === "interval") {
      if (bill.next_due_date && bill.next_due_date < today) {
        open.push({ kind: "bill", name: bill.name, dueDate: bill.next_due_date, amount: null, asks: unansweredAsksInCycle(bill, today), maxAsks: BILL_MAX_UNANSWERED_ASKS });
      }
      continue;
    }
    const cycle = lastBillDueDate(bill.day_of_month, today);
    if (cycle.dueDate >= today) continue; // vence hoje: aparece no proprio dia
    if (bill.confirmed_month === cycle.yearMonth) continue;
    if (sqliteUtcToSpDate(bill.created_at) > cycle.dueDate) continue; // o alerta nem existia no vencimento
    open.push({ kind: "bill", name: bill.name, dueDate: cycle.dueDate, amount: null, asks: unansweredAsksInCycle(bill, today), maxAsks: BILL_MAX_UNANSWERED_ASKS });
  }
  for (const missed of getMissedRecurringExpenses(today, undefined, fromNumber)) {
    if (missed.dueDate >= today) continue;
    open.push({ kind: "recurring", name: missed.recurring.description, dueDate: missed.dueDate, amount: missed.recurring.amount, asks: 0, maxAsks: BILL_MAX_UNANSWERED_ASKS });
  }
  return open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "pt-BR"));
}

export function sortFinanceItems(items: FinanceItem[]): FinanceItem[] {
  return [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "pt-BR") || (a.installment?.number ?? 0) - (b.installment?.number ?? 0)
  );
}

export function listFinanceItems(fromNumber: string, range: Pick<AgendaRange, "startDate" | "endDate">, now: Date = new Date(Date.now()), max: number = MAX_FINANCE_ITEMS): FinanceAgenda {
  const today = spDateString(now);
  const bills = db.prepare(`SELECT * FROM bill_alerts WHERE from_number = ? AND active = 1`).all(fromNumber) as unknown as BillAlert[];
  const all = sortFinanceItems([
    ...recurringItems(fromNumber, range.startDate, range.endDate, today),
    ...billItems(bills, fromNumber, range.startDate, range.endDate, today),
    ...futureExpenseItems(fromNumber, range.startDate, range.endDate, today),
  ]);
  const total = all.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  return {
    openItems: openItemsFor(bills, fromNumber, today),
    items: all.slice(0, max),
    hiddenCount: Math.max(0, all.length - max),
    total: Math.round(total * 100) / 100,
    withoutValue: all.filter((item) => item.amount === null).length,
  };
}
