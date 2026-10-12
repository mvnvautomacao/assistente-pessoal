// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer apagar a categoria X?" antes de apagar de verdade (os gastos dela ficam
// sem categoria, entao vale confirmar). Mesma ideia de pendingMergeCategories.ts.
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingDeleteCategory {
  categoryId: number;
  categoryName: string;
  expenseIds: number[];
  createdAt: number;
}

const KIND = "delete_category";
const VERSION = 1;

export function setPendingDeleteCategory(fromNumber: string, data: Omit<PendingDeleteCategory, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.categoryName, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingDeleteCategory(fromNumber: string): PendingDeleteCategory | null {
  const stored = getPending<Omit<PendingDeleteCategory, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingDeleteCategory(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
