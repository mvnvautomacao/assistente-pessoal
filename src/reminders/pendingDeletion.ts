// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer apagar o lembrete X?" antes de excluir de verdade, pra resolver a
// resposta ("sim"/"nao") na proxima mensagem. Mesma ideia do
// events/pendingDeletion.ts.
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

interface PendingReminderDeletion {
  reminderId: number;
  message: string;
  createdAt: number;
}

const KIND = "delete_reminder";
const VERSION = 1;

export function setPendingReminderDeletion(fromNumber: string, reminderId: number, message: string) {
  setPending(fromNumber, KIND, { payload: { reminderId, message }, label: message, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingReminderDeletion(fromNumber: string): PendingReminderDeletion | null {
  const stored = getPending<{ reminderId: number; message: string }>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingReminderDeletion(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
