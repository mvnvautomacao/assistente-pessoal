// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar X do gasto fixo Y?" antes de editar de verdade. Mesma ideia dos
// outros caches de conversa (pendingEditExpense.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface RecurringExpenseParams {
  description: string;
  amount: number;
  categoryId: number | null;
  paymentMethodId: number | null;
  dayOfMonth: number;
}

export interface PendingEditRecurring {
  recurringId: number;
  previous: RecurringExpenseParams;
  proposedParams: RecurringExpenseParams;
  changeText: string;
  createdAt: number;
}

const pending = new Map<string, PendingEditRecurring>();

export function setPendingEditRecurring(fromNumber: string, data: Omit<PendingEditRecurring, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingEditRecurring(fromNumber: string): PendingEditRecurring | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEditRecurring(fromNumber: string) {
  pending.delete(fromNumber);
}
