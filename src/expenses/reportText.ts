import { getExpenseSummaryBetween, ExpenseSummary } from "./service";
import { formatBRL } from "../confirmation/preview";
import { addDaysToDateString } from "../timeSP";
import { DateRange } from "./queryRange";

// os periodos nomeados moram em queryRange.ts (no fuso de Sao Paulo); daqui continuam exportados pra quem ja importava
export { DateRange, currentWeekRange, previousWeekRange, currentMonthRange, previousMonthRange, lastNDaysRange, singleDayRange } from "./queryRange";

// janela do mesmo tamanho, imediatamente anterior a [start, end) — pra comparar "subiu/desceu X%"
function precedingRangeOfSameLength(start: string, end: string): DateRange {
  const length = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return { start: addDaysToDateString(start, -length), end: start, label: "" };
}

function comparisonLine(current: number, previous: number): string {
  if (previous <= 0) return "";
  const change = ((current - previous) / previous) * 100;
  const arrow = change >= 0 ? "🔺" : "🔻";
  return `\n${arrow} ${Math.abs(change).toFixed(0)}% em relação ao período anterior (${formatBRL(previous)})`;
}

export interface ExpenseReportOptions {
  compare?: boolean;
  fromNumber?: string;
  categoryId?: number;
  categoryName?: string;
  paymentMethodId?: number;
  paymentMethodName?: string;
}

// "💰 Mercado · Nubank — setembro/2026", "💰 Nubank — …", "💰 Gastos — …"
export function expenseReportTitle(label: string, options: Pick<ExpenseReportOptions, "categoryName" | "paymentMethodName">): string {
  const filters = [options.categoryName, options.paymentMethodName].filter(Boolean).join(" · ");
  return filters ? `💰 ${filters} — ${label}` : `💰 Gastos — ${label}`;
}

export function buildExpenseReportText(range: DateRange, options: ExpenseReportOptions = {}): string {
  const summary = getExpenseSummaryBetween(range.start, range.end, options.fromNumber, options.categoryId, options.paymentMethodId);
  const title = expenseReportTitle(range.label, options);

  if (summary.count === 0) {
    return `${title}\n\nNenhum gasto registrado nesse período.`;
  }

  let comparison = "";
  if (options.compare) {
    const preceding = precedingRangeOfSameLength(range.start, range.end);
    const previousSummary: ExpenseSummary = getExpenseSummaryBetween(
      preceding.start,
      preceding.end,
      options.fromNumber,
      options.categoryId,
      options.paymentMethodId
    );
    comparison = comparisonLine(summary.total, previousSummary.total);
  }

  // pra uma categoria especifica ja da pra ver tudo no total, nao precisa repetir a quebra
  const categoryLines = options.categoryId
    ? ""
    : `\n\n${summary.categoryTotals.map((c) => `• ${c.name}: ${formatBRL(c.total)}`).join("\n")}`;

  return `${title}\n\nTotal: ${formatBRL(summary.total)} em ${summary.count} gasto(s)${comparison}${categoryLines}`;
}
