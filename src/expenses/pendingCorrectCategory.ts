// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar a categoria de X pra Y?" antes de aplicar de verdade. Mesma ideia
// dos outros caches de conversa (pendingDeletion.ts, pendingEditExpense.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
const TTL_MS = EDIT_PENDING_TTL_MS;

export interface PendingCorrectCategory {
  expenseId: number;
  description: string;
  amount: number;
  previousCategoryId: number | null;
  previousCategoryName: string;
  proposedCategoryId: number;
  proposedCategoryName: string;
  awaitingCorrection: boolean;
  headerText: string; // 1a linha da previa (ex: "Mercado — R$ 38,00 · 07/10 · Pix"), fixa durante a confirmacao
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
