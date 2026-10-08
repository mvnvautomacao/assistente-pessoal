// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar X pra Y?" antes de editar um gasto de verdade, pra resolver a
// resposta ("sim"/"nao"/um valor ajustado) na proxima mensagem. Mesma ideia dos
// outros caches de conversa (pendingDeletion.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
const TTL_MS = EDIT_PENDING_TTL_MS;

export interface EditExpenseParams {
  amount: number;
  description: string;
  date: string;
  categoryId: number | null;
  paymentMethodId: number | null;
}

export interface PendingEditExpense {
  expenseId: number;
  field: "amount" | "date" | "description" | "payment_method";
  description: string;
  previous: EditExpenseParams;
  proposedParams: EditExpenseParams;
  changeText: string;
  awaitingCorrection: boolean;
  headerText: string; // 1a linha da previa (ex: "Mercado — R$ 38,00 · 07/10 · Pix"), fixa durante a confirmacao
  createdAt: number;
}

const pending = new Map<string, PendingEditExpense>();

export function setPendingEditExpense(fromNumber: string, data: Omit<PendingEditExpense, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingEditExpense(fromNumber: string): PendingEditExpense | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEditExpense(fromNumber: string) {
  pending.delete(fromNumber);
}
