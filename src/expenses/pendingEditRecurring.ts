// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer mudar X do gasto fixo Y?" antes de editar de verdade. Mesma ideia dos
// outros caches de conversa (pendingEditExpense.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { clearPending, getPending, setPending } from "../pending/store";
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

const KIND = "edit_recurring";
const VERSION = 1;

export function setPendingEditRecurring(fromNumber: string, data: Omit<PendingEditRecurring, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.previous.description, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditRecurring(fromNumber: string): PendingEditRecurring | null {
  const stored = getPending<Omit<PendingEditRecurring, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEditRecurring(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
