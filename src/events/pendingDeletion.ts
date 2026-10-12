// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer cancelar o evento X?" antes de excluir de verdade, pra resolver a
// resposta ("sim"/"nao") na proxima mensagem. Mesma ideia dos outros caches
// de conversa (listCache.ts, pendingListChoice.ts).
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

interface PendingDeletion {
  eventId: number;
  title: string;
  createdAt: number;
}

const KIND = "delete_event";
const VERSION = 1;

export function setPendingEventDeletion(fromNumber: string, eventId: number, title: string) {
  setPending(fromNumber, KIND, { payload: { eventId, title }, label: title, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEventDeletion(fromNumber: string): PendingDeletion | null {
  const stored = getPending<{ eventId: number; title: string }>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEventDeletion(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
