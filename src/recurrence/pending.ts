// Estado do cadastro de gasto fixo / alerta de conta (Card 13), persistido em pending_state (ver
// pending/store.ts): sobrevive a reinicio e expira em 10 minutos. Nada e gravado nas tabelas de gasto
// fixo ou de alerta antes da confirmacao -- so este rascunho.
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { RecurrenceDraft, RecurrenceField, RecurrenceMode } from "./rules";
import type { CorrectionField } from "./messages";

export type RecurrenceStep = "choose_type" | "fill" | "duplicate" | "confirm" | "this_month";

export interface PendingCreateRecurrence {
  mode: RecurrenceMode;
  step: RecurrenceStep;
  draft: RecurrenceDraft;
  // pergunta de preenchimento em aberto (step = fill)
  ask?: RecurrenceField;
  // item ja existente quando a duplicata foi detectada (step = duplicate)
  duplicateOfId?: number;
  // "corrigir" da previa: primeiro escolhe o campo, depois responde o valor
  correction?: { stage: "pick" | "value"; field?: CorrectionField };
  createdAt: number;
}

const KIND = "create_recurrence";
const VERSION = 1;

export function recurrenceLabel(data: Pick<PendingCreateRecurrence, "mode" | "draft">): string {
  return data.draft.description?.trim() || (data.mode === "bill_alert" ? "alerta de conta" : "gasto fixo");
}

export function setPendingCreateRecurrence(fromNumber: string, data: Omit<PendingCreateRecurrence, "createdAt">) {
  setPending(fromNumber, KIND, { payload: data, label: recurrenceLabel(data), ttlMs: EDIT_PENDING_TTL_MS, version: VERSION });
}

export function getPendingCreateRecurrence(fromNumber: string): PendingCreateRecurrence | null {
  const stored = getPending<Omit<PendingCreateRecurrence, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, createdAt: stored.createdAt } : null;
}

export function clearPendingCreateRecurrence(fromNumber: string) {
  clearPending(fromNumber, KIND);
}
