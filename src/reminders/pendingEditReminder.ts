// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer mudar o lembrete X pra data/hora Y?" antes de aplicar de verdade. Mesma
// ideia dos outros caches de conversa (pendingDeletion.ts etc).
const TTL_MS = 5 * 60 * 1000;

export interface PendingEditReminder {
  reminderId: number;
  message: string; // texto ATUAL (antes dessa edicao) -- usado nas mensagens de confirmacao
  previousDueAt: string;
  proposedMessage: string;
  proposedDueAt: string;
  // mesma ideia do PendingEditEvent: so reinterpreta resposta livre como nova
  // data/hora quando a mudanca pedida envolve data/hora.
  isDateTimeChange: boolean;
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
