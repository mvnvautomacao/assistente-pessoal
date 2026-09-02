// Cache curto e em memoria: guarda o gasto lido de uma foto de comprovante
// enquanto falta resolver categoria/forma de pagamento e/ou confirmar antes
// de registrar de verdade (foto erra mais que texto digitado, por isso SEMPRE
// passa por confirmacao, mesmo quando a leitura veio completa). Slot unico
// por numero (nao fila, ao contrario de pendingCompletion.ts) -- e raro
// mandar uma segunda foto antes de responder a primeira.
const TTL_MS = 5 * 60 * 1000;

export interface PendingReceiptConfirmation {
  description: string;
  date: string;
  totalAmount?: number;
  installmentAmount?: number;
  installments?: number;
  category?: string;
  paymentMethod?: string;
  awaiting: "category" | "payment_method" | "confirm";
  createdAt: number;
}

const pending = new Map<string, PendingReceiptConfirmation>();

export function setPendingReceiptConfirmation(fromNumber: string, data: Omit<PendingReceiptConfirmation, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingReceiptConfirmation(fromNumber: string): PendingReceiptConfirmation | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingReceiptConfirmation(fromNumber: string) {
  pending.delete(fromNumber);
}
