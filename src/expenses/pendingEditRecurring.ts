// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar X do gasto fixo Y?" antes de editar de verdade. Mesma ideia dos
// outros caches de conversa (pendingEditExpense.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
const TTL_MS = EDIT_PENDING_TTL_MS;

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
  // categoria / forma de pagamento que ainda nao existem: so sao criadas na confirmacao
  newCategoryName?: string | null;
  newPaymentMethodName?: string | null;
  changeText: string;
  awaitingCorrection: boolean;
  headerText: string; // 1a linha da previa (ex: "Mercado — R$ 38,00 · 07/10 · Pix"), fixa durante a confirmacao
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
