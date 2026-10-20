// Card 21 (D-08, RN13): ao confirmar a previa de uma edicao, o registro ATUAL e comparado com o `previous` guardado na previa.
// Mudou no meio da conversa (outra edicao, rotina, outro aparelho) -> nao aplica nada e avisa. Tudo funcao pura, sem banco.
// Molde: expenseChangedSince / incomeChangedSince (router.ts). So os campos que o usuario edita entram na comparacao.
import type { BillParams } from "../bills/editPlan";
import { recurrenceText } from "../bills/editPlan";
import type { EventSnapshot } from "../events/editPlan";
import type { RecurringExpenseParams } from "../expenses/pendingEditRecurring";
import { formatBRL, formatWhen } from "./preview";

const sameInstant = (a: string, b: string): boolean => new Date(a).getTime() === new Date(b).getTime();

export function eventChangedSince(current: EventSnapshot, previous: EventSnapshot): boolean {
  return (
    current.title !== previous.title ||
    !sameInstant(current.start, previous.start) ||
    !sameInstant(current.end, previous.end) ||
    (current.location ?? null) !== (previous.location ?? null) ||
    current.reminderMinutes !== previous.reminderMinutes
  );
}

export interface ReminderSnapshot {
  message: string;
  dueAt: string;
}

export function reminderChangedSince(current: ReminderSnapshot, previous: ReminderSnapshot): boolean {
  return current.message !== previous.message || !sameInstant(current.dueAt, previous.dueAt);
}

export function recurringChangedSince(current: RecurringExpenseParams, previous: RecurringExpenseParams): boolean {
  return (
    current.description !== previous.description ||
    current.amount !== previous.amount ||
    current.categoryId !== previous.categoryId ||
    current.paymentMethodId !== previous.paymentMethodId ||
    current.dayOfMonth !== previous.dayOfMonth
  );
}

export function billChangedSince(current: BillParams, previous: BillParams): boolean {
  return (
    current.name !== previous.name ||
    recurrenceText(current) !== recurrenceText(previous) ||
    (current.recurrenceType === "interval" && current.nextDueDate !== previous.nextDueDate)
  );
}

export type ChangedItemKind = "evento" | "lembrete" | "gasto fixo" | "alerta";

// "O evento "Dentista" mudou enquanto a gente conversava (agora está qui 15/10 às 10:00). Me pede a alteração de novo."
export function changedWhileTalkingText(kind: ChangedItemKind, name: string, currentValue: string): string {
  return `O ${kind} "${name}" mudou enquanto a gente conversava (agora está ${currentValue}). Me pede a alteração de novo.`;
}

export function eventCurrentValue(current: EventSnapshot): string {
  return formatWhen(current.start);
}

export function reminderCurrentValue(current: ReminderSnapshot): string {
  return formatWhen(current.dueAt);
}

export function recurringCurrentValue(current: RecurringExpenseParams): string {
  return `${formatBRL(current.amount)} todo dia ${current.dayOfMonth}`;
}

export function billCurrentValue(current: BillParams): string {
  return recurrenceText(current);
}
