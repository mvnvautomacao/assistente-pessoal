// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer remover o orcamento de X?" antes de aplicar de verdade. Mesma ideia dos
// outros caches de conversa (pendingDeletion.ts etc).
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingRemoveBudget {
  categoryId: number;
  categoryName: string;
  monthlyLimit: number;
  createdAt: number;
}

const KIND = "remove_budget";
const VERSION = 1;

export function setPendingRemoveBudget(fromNumber: string, data: Omit<PendingRemoveBudget, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: `Orçamento de ${data.categoryName}`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingRemoveBudget(fromNumber: string): PendingRemoveBudget | null {
  const stored = getPending<Omit<PendingRemoveBudget, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingRemoveBudget(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
