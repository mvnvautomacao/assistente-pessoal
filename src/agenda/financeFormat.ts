// Texto da agenda financeira (Card 22, RN03 a RN08, RF03). Puro: recebe o resultado de listFinanceItems e devolve a mensagem.
// Sem numeracao (RN09): e uma consulta, nao uma lista para "edita o 2".
import { formatBRL } from "../confirmation/preview";
import type { FinanceAgenda, FinanceItem, OpenItem } from "./finance";
import { dayHeader, truncateTitle } from "./format";

export interface FinanceFormatInput {
  title: string; // "💳 Agenda financeira — próximos 30 dias"
  finance: FinanceAgenda;
  today: string; // YYYY-MM-DD (SP)
  link: string; // painel, usado quando passa do teto
  emptyText: string; // "Nada a pagar neste período. 🎉"
  notice?: string; // linha antes do titulo
}

// "dia 10" no mes de hoje, "dia 10/09" fora dele
function dueDay(dueDate: string, today: string): string {
  const [, month, day] = dueDate.split("-");
  return dueDate.slice(0, 7) === today.slice(0, 7) ? `dia ${day}` : `dia ${day}/${month}`;
}

export function openItemLine(item: OpenItem, today: string): string {
  const name = truncateTitle(item.name);
  if (item.kind === "recurring") {
    return `• ${name} · ${formatBRL(item.amount ?? 0)} · venceu ${dueDay(item.dueDate, today)}, ainda não lançado (lança sozinho)`;
  }
  const asks = item.asks > 0 ? ` (${item.asks} de ${item.maxAsks} avisos)` : "";
  return `• ${name} · venceu ${dueDay(item.dueDate, today)}, aguardando sua resposta${asks}`;
}

export function financeItemLine(item: FinanceItem): string {
  const name = truncateTitle(item.name);
  if (item.kind === "recurring") return `🔁 ${name} · ${formatBRL(item.amount ?? 0)} (lança sozinho)`;
  if (item.kind === "installment") return `🧾 ${name} · parcela ${item.installment!.number}/${item.installment!.total} · ${formatBRL(item.amount ?? 0)}`;
  if (item.kind === "future") return `🧾 ${name} · ${formatBRL(item.amount ?? 0)} (lançamento futuro)`;
  const every = item.recurrence ? ` · ${item.recurrence}` : "";
  if (item.amount === null) return `📌 ${name} · valor a informar${item.recurrence ? ` (${item.recurrence})` : ""}`;
  return `📌 ${name} · ≈ ${formatBRL(item.amount)} (último${every})`;
}

export function formatFinanceAgenda(input: FinanceFormatInput): string {
  const { finance, today } = input;
  const prefix = input.notice ? `${input.notice}\n\n` : "";
  const blocks: string[] = [];

  if (finance.openItems.length) blocks.push(`⚠️ Em aberto\n${finance.openItems.map((item) => openItemLine(item, today)).join("\n")}`);

  if (finance.items.length === 0) {
    if (finance.openItems.length === 0) blocks.push(input.emptyText); // com itens em aberto, so eles (nada a pagar alem disso nao precisa de frase)
    return `${prefix}${input.title}\n\n${blocks.join("\n\n")}`;
  }

  const lines: string[] = [];
  let currentDay = "";
  for (const item of finance.items) {
    if (item.date !== currentDay) {
      if (currentDay) lines.push("");
      lines.push(dayHeader(item.date, today));
      currentDay = item.date;
    }
    lines.push(financeItemLine(item));
  }
  blocks.push(lines.join("\n"));

  if (finance.hiddenCount > 0) {
    blocks.push(`…e mais ${finance.hiddenCount} ${finance.hiddenCount === 1 ? "item" : "itens"}. Veja tudo no painel: ${input.link}`);
  }

  const totals: string[] = [];
  if (finance.total > 0) totals.push(`Total previsto: ${formatBRL(finance.total)}`);
  if (finance.withoutValue > 0) totals.push(`${finance.total > 0 ? "+ " : ""}${finance.withoutValue} sem valor definido`);
  if (totals.length) blocks.push(totals.join("\n"));

  return `${prefix}${input.title}\n\n${blocks.join("\n\n")}`;
}
