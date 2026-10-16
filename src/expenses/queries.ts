// Consultas de gastos e entradas pelo WhatsApp (Card 14): lista de gastos (ultimas N, filtros, periodo), relatorio de
// gastos, entradas e saldo. Cada funcao devolve o texto pronto (e o que o router precisa guardar), sem enviar nada:
// o router so manda a mensagem e grava a lista mostrada. Datas sempre no fuso de Sao Paulo.
import { config } from "../config";
import { formatBRL } from "../confirmation/preview";
import { formatIncomeList, MAX_INCOME_LIST } from "../confirmation/incomePreview";
import { DEFAULT_RECENT_LIST, MAX_PERIOD_LIST, MAX_RECENT_LIST, formatExpenseList } from "../confirmation/listFormat";
import { getIncomeSummaryBetween, listIncomesBetween } from "../incomes/service";
import { getRangeBalance } from "./balance";
import { currentMonthRange, DateRange, RangeParams, resolveQueryRange, singleDayRange } from "./queryRange";
import { ExpenseFilters, filterLabel, filterPhrase, hasAnyFilter, resolveExpenseFilters } from "./queryFilters";
import { buildExpenseReportText } from "./reportText";
import { getExpensesBetween, getExpenseSummaryBetween, getRecentExpensesList } from "./service";
import { spDateString } from "../timeSP";

const nowToday = () => spDateString(new Date(Date.now()));

// ---------------------------------------------------------------------------
// lista de gastos (list_expenses)
// ---------------------------------------------------------------------------

export interface ListExpensesParams extends RangeParams {
  last_n?: number;
  category?: string;
  payment_method?: string;
  fixed_only?: boolean;
}

export type ListExpensesOutcome =
  | {
      type: "reply";
      text: string;
      log: string;
      preface?: string; // mensagem enviada ANTES (ex: "voce nao disse o dia")
      shownIds?: number[]; // lista mostrada (pro "muda o 2 pra 45")
      label?: string;
    }
  | { type: "ask_format"; days: number; log: string }; // "resumo ou detalhado?"

const NO_DAY_PREFACE =
  'Você não disse o dia, então vou te mostrar as compras de hoje. Se quiser outro dia, é só especificar, ex: "editar compras de ontem" ou "gastos do dia 20".';

export const MAX_RECENT_NOTE = `Mostrei as ${MAX_RECENT_LIST} últimas (é o máximo por mensagem).`;

function daysInRange(range: DateRange): number {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000);
}

function emptyListText(filters: ExpenseFilters, label?: string): string {
  if (filters.fixedOnly) return "Nenhuma conta fixa lançada nesse período.";
  const phrase = filterPhrase(filters);
  if (!phrase) return label ? `Nenhum gasto registrado em ${label}.` : "Você ainda não tem nenhum gasto registrado.";
  return label ? `Nenhum gasto ${phrase} em ${label}.` : `Nenhum gasto ${phrase} registrado.`;
}

// RN01/RN02: os N gastos mais recentes (opcionalmente dentro de um periodo), com os filtros
function recentList(from: string, params: ListExpensesParams, filters: ExpenseFilters, range: DateRange | null, today: string): ListExpensesOutcome {
  let n = DEFAULT_RECENT_LIST;
  let note: string | undefined;
  if (typeof params.last_n === "number" && Number.isFinite(params.last_n)) {
    n = Math.floor(params.last_n);
    if (n < 1) n = DEFAULT_RECENT_LIST;
    else if (n > MAX_RECENT_LIST) {
      n = MAX_RECENT_LIST;
      note = MAX_RECENT_NOTE;
    }
  }
  const items = getRecentExpensesList(from, n, { ...filters, start: range?.start, end: range?.end });
  if (!items.length) {
    return { type: "reply", text: emptyListText(filters, range?.label), log: `nenhum gasto (ultimas ${n}${range ? `, ${range.label}` : ""})` };
  }
  const count = items.length;
  const noun = count === 1 ? "último gasto" : `últimos ${count} gastos`;
  const label = filterLabel(filters);
  const base = label ? `${label} — ${noun}` : `${count === 1 ? "Último gasto" : `Últimos ${count} gastos`}`;
  const title = range ? `${base} (${range.label})` : base;
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const out = formatExpenseList({ title, items, total, totalCount: count, today, grouped: false, dashboardUrl: config.dashboardUrl, note });
  return {
    type: "reply",
    text: out.text,
    log: `${count} gasto(s) (ultimas ${n}${label ? `, ${label}` : ""}${range ? `, ${range.label}` : ""})`,
    shownIds: out.shown.map((i) => i.id),
    label: title,
  };
}

// lista detalhada de um periodo (com filtros opcionais), com teto de linhas e total do conjunto completo (RN10)
export function periodExpenseList(from: string, range: DateRange, filters: ExpenseFilters = {}, today: string = nowToday()): ListExpensesOutcome {
  const summary = getExpenseSummaryBetween(range.start, range.end, from, filters.categoryId, filters.paymentMethodId, filters.fixedOnly);
  if (summary.count === 0) {
    return { type: "reply", text: emptyListText(filters, range.label), log: `nenhum gasto em ${range.label}` };
  }
  const items = getExpensesBetween(from, range.start, range.end, { ...filters, limit: MAX_PERIOD_LIST });
  const phrase = filterPhrase(filters);
  const title = `${filters.fixedOnly ? "Contas fixas" : "Gastos"}${phrase ? ` ${phrase}` : ""} — ${range.label}`;
  const grouped = daysInRange(range) > 1;
  const out = formatExpenseList({ title, items, total: summary.total, totalCount: summary.count, today, grouped, dashboardUrl: config.dashboardUrl });
  return {
    type: "reply",
    text: out.text,
    log: `${summary.count} gasto(s) em ${range.label}${phrase ? ` (${phrase})` : ""}${grouped ? " (detalhado)" : ""}`,
    shownIds: out.shown.map((i) => i.id),
    label: range.label,
  };
}

export function runListExpenses(from: string, params: ListExpensesParams, today: string = nowToday()): ListExpensesOutcome {
  const resolved = resolveQueryRange(params, today);
  if (!resolved.ok) return { type: "reply", text: resolved.error, log: "periodo invalido" };
  const filterResult = resolveExpenseFilters(from, params);
  if (!filterResult.ok) return { type: "reply", text: filterResult.message, log: "filtro nao encontrado" };
  const filters = filterResult.filters;
  const filtered = hasAnyFilter(filters);
  const range = resolved.range;

  // "ultimas N" (ou so um filtro, sem periodo): RN01 e RN02
  if (params.last_n !== undefined || (filtered && !range)) return recentList(from, params, filters, range, today);

  // pedido vago ("editar compras"): avisa qual dia foi assumido e mostra hoje
  if (!range) {
    const out = periodExpenseList(from, singleDayRange(today, "hoje"), {}, today);
    return out.type === "reply" ? { ...out, preface: NO_DAY_PREFACE } : out;
  }

  // varios dias SEM filtro: pergunta se quer o resumo ou o detalhado (com filtro vai direto pro detalhado, RN03)
  if (!filtered && resolved.source === "days" && (params.days ?? 0) > 1) {
    return { type: "ask_format", days: Math.floor(params.days!), log: `perguntou formato pros ultimos ${params.days} dias` };
  }

  return periodExpenseList(from, range, filters, today);
}

// ---------------------------------------------------------------------------
// relatorio de gastos (expense_report)
// ---------------------------------------------------------------------------

export interface ExpenseReportParams extends RangeParams {
  category?: string;
  payment_method?: string;
  fixed_only?: boolean;
}

export function runExpenseReport(from: string, params: ExpenseReportParams, today: string = nowToday()): { text: string; log: string } {
  const resolved = resolveQueryRange(params, today);
  if (!resolved.ok) return { text: resolved.error, log: "periodo invalido" };
  const filterResult = resolveExpenseFilters(from, params);
  if (!filterResult.ok) return { text: filterResult.message, log: "filtro nao encontrado" };
  const { filters } = filterResult;
  const range = resolved.range ?? currentMonthRange(today);
  const text = buildExpenseReportText(range, {
    compare: true,
    fromNumber: from,
    categoryId: filters.categoryId,
    categoryName: filters.categoryName,
    paymentMethodId: filters.paymentMethodId,
    paymentMethodName: filters.paymentMethodName,
    fixedOnly: filters.fixedOnly,
  });
  const filterNote = filterLabel(filters);
  return { text, log: `${range.label}${filterNote ? ` (${filterNote})` : ""}` };
}

// ---------------------------------------------------------------------------
// entradas e saldo (income_report, list_incomes, balance)
// ---------------------------------------------------------------------------

export function runIncomeReport(from: string, params: RangeParams, today: string = nowToday()): { text: string; log: string } {
  const resolved = resolveQueryRange(params, today);
  if (!resolved.ok) return { text: resolved.error, log: "periodo invalido" };
  const range = resolved.range ?? currentMonthRange(today);
  const summary = getIncomeSummaryBetween(range.start, range.end, from);
  const log = `${range.label}: ${formatBRL(summary.total)} em ${summary.count} entrada(s)`;
  if (!summary.count) return { text: `💵 Entradas — ${range.label}\n\nNenhuma entrada registrada nesse período.`, log };
  return { text: `💵 Entradas — ${range.label}\n\nTotal: ${formatBRL(summary.total)} em ${summary.count} entrada(s)`, log };
}

export function runListIncomes(
  from: string,
  params: RangeParams,
  today: string = nowToday()
): { text: string; log: string; shownIds?: number[]; label?: string } {
  const resolved = resolveQueryRange(params, today);
  if (!resolved.ok) return { text: resolved.error, log: "periodo invalido" };
  const range = resolved.range ?? currentMonthRange(today);
  const all = listIncomesBetween(from, range.start, range.end);
  if (!all.length) {
    return { text: `💵 Entradas — ${range.label}\n\nNenhuma entrada registrada nesse período.`, log: `nenhuma entrada em ${range.label}` };
  }
  const shown = all.slice(0, MAX_INCOME_LIST);
  const summary = getIncomeSummaryBetween(range.start, range.end, from);
  return {
    text: formatIncomeList({ label: range.label, items: shown, total: summary.total, totalCount: all.length, dashboardUrl: config.dashboardUrl }),
    log: `${all.length} entrada(s) em ${range.label}`,
    shownIds: shown.map((i) => i.id),
    label: range.label,
  };
}

export function runBalance(from: string, params: RangeParams, today: string = nowToday()): { text: string; log: string } {
  const resolved = resolveQueryRange(params, today);
  if (!resolved.ok) return { text: resolved.error, log: "periodo invalido" };
  const range = resolved.range ?? currentMonthRange(today);
  // regra: gasto no Pix/dinheiro (e sem forma de pagamento) abate das entradas; gasto no cartao so abate do
  // limite do cartao (se o usuario informou um -- sem limite, so mostra quanto foi gasto no cartao)
  const bal = getRangeBalance(from, range.start, range.end);
  const balanceEmoji = bal.balance >= 0 ? "✅" : "🔻";
  const cardLines =
    bal.spentCard > 0 || bal.cards.length
      ? `\n\n💳 No cartão: ${formatBRL(bal.spentCard)} (não abate do saldo)` +
        bal.cards.map((c) => `\n   • ${c.name}: limite disponível ${formatBRL(c.available)} de ${formatBRL(c.limit)}`).join("")
      : "";
  const log = `${range.label}: entradas ${formatBRL(bal.incomeTotal)}, gastos (pix/dinheiro) ${formatBRL(bal.spentNonCard)}, saldo ${formatBRL(bal.balance)}`;
  const text = `📊 Saldo — ${range.label}\n\n💵 Entradas: ${formatBRL(bal.incomeTotal)}\n💰 Gastos (Pix/dinheiro): ${formatBRL(bal.spentNonCard)}\n${balanceEmoji} Saldo: ${formatBRL(bal.balance)}${cardLines}`;
  return { text, log };
}
