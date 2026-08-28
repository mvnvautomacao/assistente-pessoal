// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer parar de lancar o gasto fixo X?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingRemoveRecurring {
  recurringId: number;
  description: string;
  amount: number;
  dayOfMonth: number;
  categoryId: number | null;
  paymentMethodId: number | null;
  createdAt: number;
}

const pending = new Map<string, PendingRemoveRecurring>();

export function setPendingRemoveRecurring(fromNumber: string, data: Omit<PendingRemoveRecurring, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingRemoveRecurring(fromNumber: string): PendingRemoveRecurring | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingRemoveRecurring(fromNumber: string) {
  pending.delete(fromNumber);
}
