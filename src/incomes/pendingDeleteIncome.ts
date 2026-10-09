// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "quer mesmo apagar
// essa entrada?" (1 apagar / 3 cancelar). Guarda um instantaneo da entrada pra
// conferir, antes de apagar, que ela nao mudou nem sumiu no meio do caminho.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { IncomeParams } from "./pendingEditIncome";
import { clearPending, getPending, setPending } from "../pending/store";
import { formatBRL } from "../confirmation/preview";

export interface PendingDeleteIncome {
  incomeId: number;
  snapshot: IncomeParams;
  createdAt: number;
}

const KIND = "delete_income";
const VERSION = 1;

export function setPendingDeleteIncome(fromNumber: string, data: Omit<PendingDeleteIncome, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: `${data.snapshot.description} — ${formatBRL(data.snapshot.amount)}`, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingDeleteIncome(fromNumber: string): PendingDeleteIncome | null {
  const stored = getPending<Omit<PendingDeleteIncome, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingDeleteIncome(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
