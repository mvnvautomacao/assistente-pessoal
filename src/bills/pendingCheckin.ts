// Estado do aviso "ja pagou a conta X?" (Card 15), persistido em pending_state (ver pending/store.ts): sobrevive a
// reinicio do servidor. Duas etapas: ask_paid (a lista 1/2/3, ate 20 h -- o bot que puxou o assunto, entao o
// usuario pode demorar) e ask_value (esperando o valor, 10 min como as outras confirmacoes). Varios avisos no mesmo
// dia viram uma fila: o primeiro e o da vez e os outros esperam em "queued".
import { clearPending, getPending, setPending } from "../pending/store";
import { EDIT_PENDING_TTL_MS } from "../confirmation/constants";
import { BillRecurrence } from "./checkinReply";

export const BILL_CHECKIN_PAID_TTL_MS = 20 * 60 * 60 * 1000;

export type BillCheckinStep = "ask_paid" | "ask_value";

export interface BillCheckinItem {
  billAlertId: number;
  name: string;
  recurrenceType: BillRecurrence;
  intervalDays: number | null;
  monthEndFromDay?: number | null; // aviso antecipado pro ultimo dia do mes (Card 16, RN17)
  lateFromDate?: string | null; // vencimento perdido pelo servidor (Card 19, RN06)
  isLastAsk?: boolean; // 3o aviso sem resposta (Card 21)
}

export interface PendingBillCheckin extends BillCheckinItem {
  step: BillCheckinStep;
  queued: BillCheckinItem[];
  createdAt: number;
}

const KIND = "bill_checkin";
const VERSION = 1;

export function setPendingBillCheckin(
  fromNumber: string,
  data: Omit<PendingBillCheckin, "createdAt" | "queued" | "step"> & { step?: BillCheckinStep; queued?: BillCheckinItem[] }
) {
  const step: BillCheckinStep = data.step ?? "ask_paid";
  const payload = { ...data, step, queued: data.queued ?? [] };
  const ttlMs = step === "ask_value" ? EDIT_PENDING_TTL_MS : BILL_CHECKIN_PAID_TTL_MS;
  setPending(fromNumber, KIND, { payload, label: data.name, ttlMs, version: VERSION });
}

export function getPendingBillCheckin(fromNumber: string): PendingBillCheckin | null {
  const stored = getPending<Omit<PendingBillCheckin, "createdAt">>(fromNumber, KIND, VERSION);
  return stored ? { ...stored.payload, queued: stored.payload.queued ?? [], createdAt: stored.createdAt } : null;
}

export function clearPendingBillCheckin(fromNumber: string) {
  clearPending(fromNumber, KIND);
}

// novo aviso: vira o da vez se nao ha nenhum aberto; senao espera na fila (e nao entra duas vezes)
export function enqueueBillCheckin(fromNumber: string, item: BillCheckinItem): "head" | "queued" {
  const current = getPendingBillCheckin(fromNumber);
  if (!current) {
    setPendingBillCheckin(fromNumber, { ...item, step: "ask_paid" });
    return "head";
  }
  if (current.billAlertId === item.billAlertId) {
    // o mesmo alerta perguntando de novo (ex: dia seguinte): volta pra etapa da lista
    setPendingBillCheckin(fromNumber, { ...item, step: "ask_paid", queued: current.queued });
    return "head";
  }
  if (!current.queued.some((q) => q.billAlertId === item.billAlertId)) {
    const { createdAt, ...rest } = current;
    void createdAt;
    setPendingBillCheckin(fromNumber, { ...rest, queued: [...current.queued, item] });
  }
  return "queued";
}

// o aviso da vez foi resolvido: o proximo da fila (se houver) vira o da vez, na etapa da lista
export function advanceBillCheckin(fromNumber: string): BillCheckinItem | null {
  const current = getPendingBillCheckin(fromNumber);
  if (!current) return null;
  const [next, ...rest] = current.queued;
  if (!next) {
    clearPendingBillCheckin(fromNumber);
    return null;
  }
  setPendingBillCheckin(fromNumber, { ...next, step: "ask_paid", queued: rest });
  return next;
}

// o alerta fechou sozinho (3 avisos sem resposta): sai do aviso aberto. Se era o da vez, o proximo da fila assume (sem reenviar nada: a
// pergunta dele ja saiu); se estava na fila, e retirado (Card 21, RN11).
export function removeBillFromCheckin(fromNumber: string, billAlertId: number) {
  const current = getPendingBillCheckin(fromNumber);
  if (!current) return;
  if (current.billAlertId === billAlertId) {
    const [next, ...rest] = current.queued;
    if (!next) clearPendingBillCheckin(fromNumber);
    else setPendingBillCheckin(fromNumber, { ...next, step: "ask_paid", queued: rest });
    return;
  }
  if (current.queued.some((q) => q.billAlertId === billAlertId)) {
    const { createdAt, ...rest } = current;
    void createdAt;
    setPendingBillCheckin(fromNumber, { ...rest, queued: current.queued.filter((q) => q.billAlertId !== billAlertId) });
  }
}
