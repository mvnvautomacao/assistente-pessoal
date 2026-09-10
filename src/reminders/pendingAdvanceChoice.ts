// Cache curto e em memoria: lembrete simples nao suporta "avisar X minutos
// antes" (isso e um recurso so de evento, via reminder_minutes) -- quando o
// usuario pede isso, guarda os dados aqui em vez de criar o lembrete direto,
// e pergunta se ele quer que vire um EVENTO na agenda (que suporta aviso
// antecipado de verdade) ou uma explicacao de como fazer isso por conta propria.
const TTL_MS = 5 * 60 * 1000;

export interface PendingReminderAdvanceChoice {
  message: string;
  dueAt: string;
  advanceMinutes: number;
  createdAt: number;
}

const pending = new Map<string, PendingReminderAdvanceChoice>();

export function setPendingReminderAdvanceChoice(fromNumber: string, data: Omit<PendingReminderAdvanceChoice, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingReminderAdvanceChoice(fromNumber: string): PendingReminderAdvanceChoice | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingReminderAdvanceChoice(fromNumber: string) {
  pending.delete(fromNumber);
}
