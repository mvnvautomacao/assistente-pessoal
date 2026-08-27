// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar o lembrete X pra data/hora Y?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingEditReminder {
  reminderId: number;
  message: string;
  previousDueAt: string;
  proposedDueAt: string;
  changeText: string;
  createdAt: number;
}

const pending = new Map<string, PendingEditReminder>();

export function setPendingEditReminder(fromNumber: string, data: Omit<PendingEditReminder, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingEditReminder(fromNumber: string): PendingEditReminder | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingEditReminder(fromNumber: string) {
  pending.delete(fromNumber);
}
