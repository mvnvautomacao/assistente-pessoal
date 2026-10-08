// Mensagens da escolha de alvo: lista numerada de candidatos, linhas por tipo de
// item e textos de erro. Tudo funcao pura que devolve texto.
import { formatBRL, formatShortDate, formatWhen } from "../confirmation/preview";
import type { TargetKind } from "./pending";

// no maximo isso de candidatos por lista (RN02)
export const MAX_TARGET_CANDIDATES = 8;

const NOUN_PLURAL: Record<TargetKind, string> = { event: "eventos", reminder: "lembretes", expense: "gastos" };

export function eventLine(event: { title: string; start: string }): string {
  return `${event.title} — ${formatWhen(event.start)}`;
}

export function reminderLine(reminder: { message: string; due_at: string }): string {
  return `${reminder.message} — ${formatWhen(reminder.due_at)}`;
}

// "Mercado — R$ 38,00 · 07/10 · Pix" (forma de pagamento so se houver)
export function expenseLine(expense: { description: string; amount: number; date: string }, paymentMethodName?: string | null): string {
  const base = `${expense.description} — ${formatBRL(expense.amount)} · ${formatShortDate(expense.date)}`;
  return paymentMethodName ? `${base} · ${paymentMethodName}` : base;
}

export type TargetListHeader =
  | { type: "found"; query: string } // 'Achei 3 lembretes com "remedio":'
  | { type: "refined"; query: string } // 'Ainda tenho 2 opcoes com "pressao":'
  | { type: "expired" }; // lista de gastos que expirou

// lines = os candidatos MOSTRADOS (ja cortados em MAX_TARGET_CANDIDATES);
// total = quantos bateram de verdade (pra avisar que tem mais)
export function formatTargetList(params: { kind: TargetKind; header: TargetListHeader; verb: string; lines: string[]; total: number }): string {
  const { kind, header, verb, lines, total } = params;
  const title =
    header.type === "expired"
      ? "Essa lista já expirou, então não vou adivinhar pelo número. Seus últimos gastos:"
      : header.type === "refined"
        ? `Ainda tenho ${lines.length} opções com "${header.query}":`
        : `Achei ${total} ${NOUN_PLURAL[kind]} com "${header.query}":`;
  const numbered = lines.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
  const more = total > lines.length ? "\nTem mais opções. Diga o nome mais específico ou *cancelar*." : "";
  return `${title}\n${numbered}${more}\n\nQual deles você quer ${verb}? Responde com o número ou *cancelar*.`;
}

export function targetNotUnderstoodText(candidateCount: number): string {
  return `Não entendi 🤔 Responde com um número de 1 a ${candidateCount}, ou *cancelar*.`;
}

export const TARGET_GONE_TEXT = "Esse item não existe mais.";
