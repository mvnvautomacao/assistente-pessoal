// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer juntar a categoria X na Y?" antes de aplicar de verdade (a categoria de
// origem deixa de existir, entao vale confirmar). Mesma ideia dos outros caches
// de conversa (pendingDeletion.ts, pendingBulkRecategorize.ts).
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingMergeCategories {
  sourceCategoryId: number;
  sourceCategoryName: string;
  targetCategoryId: number;
  targetCategoryName: string;
  expenseIds: number[];
  createdAt: number;
}

const KIND = "merge_categories";
const VERSION = 1;

export function setPendingMergeCategories(fromNumber: string, data: Omit<PendingMergeCategories, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: `${data.sourceCategoryName} → ${data.targetCategoryName}`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingMergeCategories(fromNumber: string): PendingMergeCategories | null {
  const stored = getPending<Omit<PendingMergeCategories, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingMergeCategories(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
