// Cache curto e em memoria: guarda que um numero foi perguntado "quer mesmo apagar
// essa entrada?" (1 apagar / 3 cancelar). Guarda um instantaneo da entrada pra
// conferir, antes de apagar, que ela nao mudou nem sumiu no meio do caminho.
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import type { IncomeParams } from "./pendingEditIncome";

export interface PendingDeleteIncome {
  incomeId: number;
  snapshot: IncomeParams;
  createdAt: number;
}

const pending = new Map<string, PendingDeleteIncome>();

export function setPendingDeleteIncome(fromNumber: string, data: Omit<PendingDeleteIncome, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingDeleteIncome(fromNumber: string): PendingDeleteIncome | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > EDIT_PENDING_TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingDeleteIncome(fromNumber: string) {
  pending.delete(fromNumber);
}
