// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer apagar o lembrete X?" antes de excluir de verdade, pra resolver a
// resposta ("sim"/"nao") na proxima mensagem. Mesma ideia do
// events/pendingDeletion.ts.
const TTL_MS = 5 * 60 * 1000;

interface PendingReminderDeletion {
  reminderId: number;
  message: string;
  createdAt: number;
}

const pending = new Map<string, PendingReminderDeletion>();

export function setPendingReminderDeletion(fromNumber: string, reminderId: number, message: string) {
  pending.set(fromNumber, { reminderId, message, createdAt: Date.now() });
}

export function getPendingReminderDeletion(fromNumber: string): PendingReminderDeletion | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingReminderDeletion(fromNumber: string) {
  pending.delete(fromNumber);
}
