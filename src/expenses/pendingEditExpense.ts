// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma essas
// alteracoes?" antes de editar gasto(s) de verdade, pra resolver a resposta
// (1/2/3, sim/nao ou uma correcao) na proxima mensagem. Uma pendencia vale pra
// UM OU MAIS gastos (lote) e pra uma ou mais mudancas por gasto. Mesma ideia dos
// outros caches de conversa (pendingDeletion.ts etc).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { ExpenseEditField, RawChange } from "./editChanges";
import { clearPending, getPending, setPending } from "../pending/store";
import { formatBRL } from "../confirmation/preview";

const TTL_MS = EDIT_PENDING_TTL_MS;

export interface EditExpenseParams {
  amount: number;
  description: string;
  date: string;
  categoryId: number | null;
  paymentMethodId: number | null;
}

// uma linha da previa: "Valor: R$ 38,00 → R$ 45,00" ("(nova)" quando a categoria
// ou forma de pagamento ainda nao existe e so sera criada no "1")
export interface ExpenseChangeView {
  field: ExpenseEditField;
  label: string;
  from: string;
  to: string;
  isNew: boolean;
}

export interface ExpenseEditItem {
  expenseId: number;
  description: string; // nome atual do gasto (mensagens)
  headerText: string; // "Mercado — R$ 38,00 · 07/10 · Pix", fixa durante a confirmacao
  previous: EditExpenseParams; // instantaneo do gasto quando a previa foi criada (RN09)
  proposed: EditExpenseParams;
  rawChanges: RawChange[]; // o que o usuario pediu (ja sem o que nao muda nada)
  newCategoryName: string | null; // categoria a criar so na confirmacao
  newPaymentMethodName: string | null; // forma de pagamento a criar so na confirmacao
  views: ExpenseChangeView[];
}

export interface PendingEditExpense {
  items: ExpenseEditItem[];
  awaitingCorrection: boolean;
  // com mais de uma mudanca (ou mais de um gasto) a opcao 2 primeiro pergunta
  // QUAL corrigir ("pick"); com uma so, vai direto pro novo valor ("value")
  correctionStage: "pick" | "value";
  correctionTarget: { itemIndex: number; field: ExpenseEditField } | null;
  createdAt: number;
}

const KIND = "edit_expense";
const VERSION = 1;

export function setPendingEditExpense(fromNumber: string, data: Omit<PendingEditExpense, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.items.length === 1 ? `${data.items[0].description} — ${formatBRL(data.items[0].previous.amount)}` : `${data.items.length} gastos`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditExpense(fromNumber: string): PendingEditExpense | null {
  const stored = getPending<Omit<PendingEditExpense, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEditExpense(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
