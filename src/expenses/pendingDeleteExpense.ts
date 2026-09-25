// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer apagar o gasto X?" antes de apagar de verdade. Guarda uma copia do gasto
// (pra "desfaz isso" poder recriar). Mesma ideia de pendingDeleteCategory.ts.
const TTL_MS = 5 * 60 * 1000;

export interface PendingDeleteExpense {
  expenseId: number;
  amount: number;
  description: string;
  date: string;
  categoryId: number | null;
  categoryName: string | null;
  paymentMethodId: number | null;
  // true quando o usuario NAO disse qual gasto (pegou o mais recente por padrao):
  // se responder "nao", mostra os ultimos pra ele escolher em vez de desistir
  offerChoices?: boolean;
  // modo "escolher": lista numerada dos ultimos gastos (ids na ordem mostrada);
  // a resposta e o numero do gasto a apagar. Os campos do gasto acima ficam vazios.
  choices?: number[];
  createdAt: number;
}

const pending = new Map<string, PendingDeleteExpense>();

export function setPendingDeleteExpense(fromNumber: string, data: Omit<PendingDeleteExpense, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingDeleteExpense(fromNumber: string): PendingDeleteExpense | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingDeleteExpense(fromNumber: string) {
  pending.delete(fromNumber);
}
