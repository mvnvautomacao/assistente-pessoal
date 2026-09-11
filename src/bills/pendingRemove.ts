// Cache curto e em memoria: guarda que um numero foi perguntado "confirma que
// quer parar de receber o alerta da conta X?" antes de aplicar de verdade.
// Mesma ideia de expenses/pendingRemoveRecurring.ts.
const TTL_MS = 5 * 60 * 1000;

export interface PendingRemoveBillAlert {
  billAlertId: number;
  name: string;
  dayOfMonth: number;
  createdAt: number;
}

const pending = new Map<string, PendingRemoveBillAlert>();

export function setPendingRemoveBillAlert(fromNumber: string, data: Omit<PendingRemoveBillAlert, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingRemoveBillAlert(fromNumber: string): PendingRemoveBillAlert | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingRemoveBillAlert(fromNumber: string) {
  pending.delete(fromNumber);
}
