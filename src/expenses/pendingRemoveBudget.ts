// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer remover o orcamento de X?" antes de aplicar de verdade. Mesma ideia dos
// outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingRemoveBudget {
  categoryId: number;
  categoryName: string;
  monthlyLimit: number;
  createdAt: number;
}

const pending = new Map<string, PendingRemoveBudget>();

export function setPendingRemoveBudget(fromNumber: string, data: Omit<PendingRemoveBudget, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingRemoveBudget(fromNumber: string): PendingRemoveBudget | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingRemoveBudget(fromNumber: string) {
  pending.delete(fromNumber);
}
