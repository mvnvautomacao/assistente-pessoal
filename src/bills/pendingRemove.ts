// Estado curto de conversa (persistido em SQLite, ver pending/store.ts): guarda que um numero foi perguntado "confirma que
// quer parar de receber o alerta da conta X?" antes de aplicar de verdade.
// Mesma ideia de expenses/pendingRemoveRecurring.ts.
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";

export interface PendingRemoveBillAlert {
  billAlertId: number;
  name: string;
  recurrenceType: "day_of_month" | "interval";
  dayOfMonth: number;
  intervalDays: number | null;
  createdAt: number;
}

const KIND = "remove_bill_alert";
const VERSION = 1;

export function setPendingRemoveBillAlert(fromNumber: string, data: Omit<PendingRemoveBillAlert, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.name, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingRemoveBillAlert(fromNumber: string): PendingRemoveBillAlert | null {
  const stored = getPending<Omit<PendingRemoveBillAlert, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingRemoveBillAlert(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
