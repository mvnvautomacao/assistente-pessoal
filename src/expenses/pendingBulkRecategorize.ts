// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer mudar N gastos pra categoria X?" antes de aplicar de verdade, pra
// resolver a resposta ("sim"/"nao") na proxima mensagem. Mesma ideia dos outros
// caches de conversa (pendingDeletion.ts etc). Tambem guarda a categoria
// ANTERIOR de cada gasto, pra dar pra desfazer em lote depois (ver pendingUndo.ts).
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingBulkRecategorize {
  expenseIds: number[];
  previous: { expenseId: number; previousCategoryId: number | null }[];
  toCategoryId: number;
  toCategoryName: string;
  summary: string; // descricao curta pro texto de confirmacao, ex: "5 gastos de hoje"
  createdAt: number;
}

const KIND = "bulk_recategorize";
const VERSION = 1;

export function setPendingBulkRecategorize(fromNumber: string, data: Omit<PendingBulkRecategorize, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: `${data.summary} → ${data.toCategoryName}`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingBulkRecategorize(fromNumber: string): PendingBulkRecategorize | null {
  const stored = getPending<Omit<PendingBulkRecategorize, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingBulkRecategorize(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
