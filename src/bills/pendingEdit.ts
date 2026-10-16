// Estado da edicao de conta fixa (Card 15), persistido em pending_state (ver pending/store.ts): o usuario viu a previa
// "antes → depois" do alerta e falta o 1/2/3. Mesmo molde das outras confirmacoes de edicao (10 min).
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { clearPending, getPending, setPending } from "../pending/store";
import type { BillChangeKey, BillParams } from "./editPlan";

export interface PendingEditBillAlert {
  billAlertId: number;
  previous: BillParams;
  proposed: BillParams;
  duplicateName: boolean; // ja existe outro alerta com o novo nome (aviso na previa, mas pode confirmar)
  awaitingCorrection: boolean;
  correctionStage: "pick" | "value";
  correctionTarget: BillChangeKey | null;
  createdAt: number;
}

const KIND = "edit_bill_alert";
const VERSION = 1;

export function setPendingEditBillAlert(fromNumber: string, data: Omit<PendingEditBillAlert, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: data.previous.name, ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingEditBillAlert(fromNumber: string): PendingEditBillAlert | null {
  const stored = getPending<Omit<PendingEditBillAlert, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingEditBillAlert(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
