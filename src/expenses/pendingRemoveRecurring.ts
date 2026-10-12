// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer parar de lancar o gasto fixo X?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingRemoveRecurring {
  recurringId: number;
  description: string;
  amount: number;
  dayOfMonth: number;
  categoryId: number | null;
  paymentMethodId: number | null;
  createdAt: number;
}

const KIND = "remove_recurring";
const VERSION = 1;

export function setPendingRemoveRecurring(fromNumber: string, data: Omit<PendingRemoveRecurring, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.description, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingRemoveRecurring(fromNumber: string): PendingRemoveRecurring | null {
  const stored = getPending<Omit<PendingRemoveRecurring, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingRemoveRecurring(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
