// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar a categoria de X pra Y?" antes de aplicar de verdade. Mesma ideia
// dos outros caches de conversa (pendingDeletion.ts, pendingEditExpense.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingCorrectCategory {
  expenseId: number;
  description: string;
  amount: number;
  previousCategoryId: number | null;
  previousCategoryName: string;
  proposedCategoryId: number;
  proposedCategoryName: string;
  createdAt: number;
}

const pending = new Map<string, PendingCorrectCategory>();

export function setPendingCorrectCategory(fromNumber: string, data: Omit<PendingCorrectCategory, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingCorrectCategory(fromNumber: string): PendingCorrectCategory | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingCorrectCategory(fromNumber: string) {
  pending.delete(fromNumber);
}
