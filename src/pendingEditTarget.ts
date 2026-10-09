
import { clearPending, getPending, setPending } from "./pending/store";
import { EDIT_PENDING_TTL_MS } from "./confirmation/constants";
// Cache curto e em memoria: o usuario mandou so "editar" (sem dizer o que) e o
// bot perguntou o que ele quer editar. A proxima resposta escolhe o alvo.
// Mesma ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

const KIND = "edit_target";
const VERSION = 1;

export function setPendingEditTarget(fromNumber: string) {
  setPending(fromNumber, KIND, { payload: {}, label: "O que você quer editar?", ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditTarget(fromNumber: string): boolean {
  return getPending(fromNumber, KIND, VERSION) !== null;
}

export function clearPendingEditTarget(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
