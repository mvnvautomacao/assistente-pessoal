// Lista de gastos no formato padrao (Card 14): valor com formatBRL, data como hoje/ontem/dd/MM, teto de linhas
// com "...e mais N" + link do painel e total SEMPRE do conjunto completo. Funcoes puras; o teto de caracteres
// garante que a mensagem cabe numa mensagem do WhatsApp mesmo com descricoes longas.
import { formatBRL } from "./preview";
import { relativeDayLabel } from "../expenses/queryRange";

export const MAX_PERIOD_LIST = 30; // linhas numa lista de periodo
export const MAX_RECENT_LIST = 20; // "ultimas N"
export const DEFAULT_RECENT_LIST = 10;
export const MAX_MESSAGE_CHARS = 3500;
export const MAX_DESCRIPTION_CHARS = 60;

export const EDIT_HINT = 'Pra editar um, é só dizer, ex: "muda o valor do 2 pra 45".';

export interface ExpenseListLine {
  id: number;
  amount: number;
  description: string;
  date: string;
  category: string | null;
  payment_method: string | null;
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function truncateText(text: string, max: number = MAX_DESCRIPTION_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// "qui 08/10" a partir de "2026-10-08" (data-calendario pura)
export function dayHeader(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

// "1. R$ 38,00 — Mercado (Alimentação, Pix) — hoje"; withDate=false nos agrupados por dia
export function formatExpenseLine(item: ExpenseListLine, index: number, options: { today: string; withDate: boolean }): string {
  const details = [item.category ?? "sem categoria", item.payment_method].filter(Boolean).join(", ");
  const date = options.withDate ? ` — ${relativeDayLabel(item.date, options.today)}` : "";
  return `${index}. ${formatBRL(item.amount)} — ${truncateText(item.description)} (${details})${date}`;
}

export interface ExpenseListInput {
  title: string;
  items: ExpenseListLine[]; // ja limitados pelo chamador (primeiros N do conjunto)
  total: number; // total do conjunto COMPLETO
  totalCount: number; // quantos gastos tem o conjunto completo
  today: string;
  grouped: boolean; // true = separado por dia (periodos de varios dias)
  dashboardUrl: string;
  note?: string; // aviso logo abaixo do titulo (ex: maximo de 20)
}

export interface ExpenseListOutput {
  text: string;
  shown: ExpenseListLine[]; // o que de fato apareceu (na ordem; a numeracao 1..n vale pra estes)
}

function renderBody(items: ExpenseListLine[], today: string, grouped: boolean): string {
  if (!grouped) return items.map((item, idx) => formatExpenseLine(item, idx + 1, { today, withDate: true })).join("\n");
  const days: string[] = [];
  const byDay = new Map<string, ExpenseListLine[]>();
  for (const item of items) {
    const day = item.date.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, []);
      days.push(day);
    }
    byDay.get(day)!.push(item);
  }
  let counter = 0;
  return days
    .map((day) => {
      const lines = byDay.get(day)!.map((item) => formatExpenseLine(item, ++counter, { today, withDate: false }));
      return `📅 ${dayHeader(day)}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function render(input: ExpenseListInput, shown: ExpenseListLine[]): string {
  const truncated = shown.length < input.totalCount;
  const header = `🧾 ${input.title}\n${input.note ? `${input.note}\n` : ""}\n`;
  const body = renderBody(shown, input.today, input.grouped);
  const more = truncated
    ? `\n\n…e mais ${input.totalCount - shown.length} ${input.totalCount - shown.length === 1 ? "gasto" : "gastos"}. Veja tudo no painel: ${input.dashboardUrl}`
    : "";
  const totalLine = truncated
    ? `💰 Total: ${formatBRL(input.total)} em ${input.totalCount} gastos (mostrando ${shown.length})`
    : `💰 Total: ${formatBRL(input.total)}`;
  return `${header}${body}${more}\n\n${totalLine}\n\n${EDIT_HINT}`;
}

export function formatExpenseList(input: ExpenseListInput): ExpenseListOutput {
  let count = input.items.length;
  let text = render(input, input.items.slice(0, count));
  // descricoes enormes: tira linhas do fim ate a mensagem caber (a numeracao so vale pro que aparece)
  while (text.length > MAX_MESSAGE_CHARS && count > 1) {
    count -= 1;
    text = render(input, input.items.slice(0, count));
  }
  return { text, shown: input.items.slice(0, count) };
}
