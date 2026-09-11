// Cache curto e em memoria: guarda que o bot perguntou "ja pagou a conta X?"
// e esta esperando a resposta (confirma pago, ou "lembra amanha"). Mesma ideia
// dos outros caches de conversa (pendingRemoveRecurring.ts etc). TTL mais longo
// que os outros -- e uma pergunta que o bot fez sozinho (nao o usuario), entao
// pode demorar bem mais que alguns minutos pra ser respondida; se expirar antes
// da resposta, o scheduler pergunta nesse mesmo dia de novo se rodar, ou no
// dia seguinte (ver getDueBillAlerts).
const TTL_MS = 20 * 60 * 60 * 1000;

export interface PendingBillCheckin {
  billAlertId: number;
  name: string;
  createdAt: number;
}

const pending = new Map<string, PendingBillCheckin>();

export function setPendingBillCheckin(fromNumber: string, data: Omit<PendingBillCheckin, "createdAt">) {
  pending.set(fromNumber, { ...data, createdAt: Date.now() });
}

export function getPendingBillCheckin(fromNumber: string): PendingBillCheckin | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry;
}

export function clearPendingBillCheckin(fromNumber: string) {
  pending.delete(fromNumber);
}
