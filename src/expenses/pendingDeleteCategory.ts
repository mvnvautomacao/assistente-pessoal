// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer apagar a categoria X?" antes de apagar de verdade (os gastos dela ficam
// sem categoria, entao vale confirmar). Mesma ideia de pendingMergeCategories.ts.
const TTL_MS = 5 * 60 * 1000;

export interface PendingDeleteCategory {
  categoryId: number;
  categoryName: string;
  expenseIds: number[];
  createdAt: number;
}

const pending = new Map<string, PendingDeleteCategory>();

export function setPendingDeleteCategory(fromNumber: string, data: Omit<PendingDeleteCategory, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingDeleteCategory(fromNumber: string): PendingDeleteCategory | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingDeleteCategory(fromNumber: string) {
  pending.delete(fromNumber);
}
