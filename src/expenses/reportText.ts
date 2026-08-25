import { getExpenseSummaryBetween, ExpenseSummary } from "./service";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  start: string;
  end: string;
  label: string;
}

export function currentWeekRange(): DateRange {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1); // inclui hoje
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { start: toDateStr(start), end: toDateStr(end), label: "essa semana" };
}

export function previousWeekRange(): DateRange {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { start: toDateStr(start), end: toDateStr(end), label: "semana passada" };
}

export function currentMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const label = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return { start: toDateStr(start), end: toDateStr(end), label: `esse mês (${label})` };
}

export function previousMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const label = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return { start: toDateStr(start), end: toDateStr(end), label };
}

// janela do mesmo tamanho, imediatamente anterior a [start, end) — pra comparar "subiu/desceu X%"
function precedingRangeOfSameLength(start: string, end: string): DateRange {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const lengthMs = endDate.getTime() - startDate.getTime();
  const precedingEnd = startDate;
  const precedingStart = new Date(startDate.getTime() - lengthMs);
  return { start: toDateStr(precedingStart), end: toDateStr(precedingEnd), label: "" };
}

function formatMoney(value: number): string {
  return `R$${value.toFixed(2)}`;
}

function comparisonLine(current: number, previous: number): string {
  if (previous <= 0) return "";
  const change = ((current - previous) / previous) * 100;
  const arrow = change >= 0 ? "🔺" : "🔻";
  return `\n${arrow} ${Math.abs(change).toFixed(0)}% em relação ao período anterior (${formatMoney(previous)})`;
}

export function buildExpenseReportText(range: DateRange, options: { compare?: boolean } = {}): string {
  const summary = getExpenseSummaryBetween(range.start, range.end);
  if (summary.count === 0) {
    return `💰 Gastos — ${range.label}\n\nNenhum gasto registrado nesse período.`;
  }

  const categoryLines = summary.categoryTotals.map((c) => `• ${c.name}: ${formatMoney(c.total)}`).join("\n");

  let comparison = "";
  if (options.compare) {
    const preceding = precedingRangeOfSameLength(range.start, range.end);
    const previousSummary: ExpenseSummary = getExpenseSummaryBetween(preceding.start, preceding.end);
    comparison = comparisonLine(summary.total, previousSummary.total);
  }

  return `💰 Gastos — ${range.label}\n\nTotal: ${formatMoney(summary.total)} em ${summary.count} gasto(s)${comparison}\n\n${categoryLines}`;
}
