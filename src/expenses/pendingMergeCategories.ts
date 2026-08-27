// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer juntar a categoria X na Y?" antes de aplicar de verdade (a categoria de
// origem deixa de existir, entao vale confirmar). Mesma ideia dos outros caches
// de conversa (pendingDeletion.ts, pendingBulkRecategorize.ts).
const TTL_MS = 5 * 60 * 1000;

export interface PendingMergeCategories {
  sourceCategoryId: number;
  sourceCategoryName: string;
  targetCategoryId: number;
  targetCategoryName: string;
  expenseIds: number[];
  createdAt: number;
}

const pending = new Map<string, PendingMergeCategories>();

export function setPendingMergeCategories(fromNumber: string, data: Omit<PendingMergeCategories, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingMergeCategories(fromNumber: string): PendingMergeCategories | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingMergeCategories(fromNumber: string) {
  pending.delete(fromNumber);
}
