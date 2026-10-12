// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer apagar o gasto X?" antes de apagar de verdade. Guarda uma copia do gasto
// (pra "desfaz isso" poder recriar). Mesma ideia de pendingDeleteCategory.ts.
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { formatBRL } from "../confirmation/preview";

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

const KIND = "delete_expense";
const VERSION = 1;

export function setPendingDeleteExpense(fromNumber: string, data: Omit<PendingDeleteExpense, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.choices ? "lista de gastos para apagar" : `${data.description} — ${formatBRL(data.amount)}`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingDeleteExpense(fromNumber: string): PendingDeleteExpense | null {
  const stored = getPending<Omit<PendingDeleteExpense, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingDeleteExpense(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
