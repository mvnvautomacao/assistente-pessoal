// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar N gastos pra categoria X?" antes de aplicar de verdade, pra
// resolver a resposta ("sim"/"nao") na proxima mensagem. Mesma ideia dos outros
// caches de conversa (pendingDeletion.ts etc). Tambem guarda a categoria
// ANTERIOR de cada gasto, pra dar pra desfazer em lote depois (ver pendingUndo.ts).
const TTL_MS = 5 * 60 * 1000;

export interface PendingBulkRecategorize {
  expenseIds: number[];
  previous: { expenseId: number; previousCategoryId: number | null }[];
  toCategoryId: number;
  toCategoryName: string;
  summary: string; // descricao curta pro texto de confirmacao, ex: "5 gastos de hoje"
  createdAt: number;
}

const pending = new Map<string, PendingBulkRecategorize>();

export function setPendingBulkRecategorize(fromNumber: string, data: Omit<PendingBulkRecategorize, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingBulkRecategorize(fromNumber: string): PendingBulkRecategorize | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingBulkRecategorize(fromNumber: string) {
  pending.delete(fromNumber);
}
