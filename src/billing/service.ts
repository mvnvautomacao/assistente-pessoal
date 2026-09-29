import { db } from "../db";
import { spDateString } from "../timeSP";

export interface ClientBilling {
  from_number: string;
  monthly_fee: number | null;
  next_due_date: string | null; // YYYY-MM-DD
  last_payment_date: string | null;
}

// Soma N meses a uma data-calendario pura, ajustando pro ultimo dia do mes se o
// dia original nao existir no mes de destino (ex: 31/01 + 1 mes = 28 ou 29/02).
// Copia local da mesma logica ja usada em router.ts (parcelas) -- nao exportada
// de la pra nao arriscar mexer num arquivo tao grande por causa disso.
function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(y, targetMonthIndex, day)).toISOString().slice(0, 10);
}

export function getClientBilling(fromNumber: string): ClientBilling | null {
  const row = db.prepare(`SELECT * FROM client_billing WHERE from_number = ?`).get(fromNumber) as ClientBilling | undefined;
  return row ?? null;
}

// so os que ja tem alguma cobranca configurada (mensalidade OU vencimento) --
// cliente recem-autorizado sem nada preenchido ainda nao aparece com linha vazia.
export function listClientBilling(): ClientBilling[] {
  return db
    .prepare(`SELECT * FROM client_billing WHERE monthly_fee IS NOT NULL OR next_due_date IS NOT NULL`)
    .all() as unknown as ClientBilling[];
}

export function setClientBillingInfo(fromNumber: string, changes: { monthlyFee?: number | null; nextDueDate?: string | null }) {
  const current = getClientBilling(fromNumber);
  const monthlyFee = changes.monthlyFee !== undefined ? changes.monthlyFee : (current?.monthly_fee ?? null);
  const nextDueDate = changes.nextDueDate !== undefined ? changes.nextDueDate : (current?.next_due_date ?? null);
  db.prepare(
    `INSERT INTO client_billing (from_number, monthly_fee, next_due_date, last_payment_date) VALUES (?, ?, ?, ?)
     ON CONFLICT(from_number) DO UPDATE SET monthly_fee = excluded.monthly_fee, next_due_date = excluded.next_due_date`
  ).run(fromNumber, monthlyFee, nextDueDate, current?.last_payment_date ?? null);
}

// "marcar como pago": sempre reinicia a contagem a partir de HOJE (mesmo
// criterio ja usado nos alertas de conta por intervalo, ver bills/service.ts),
// nao da data de vencimento original -- assim atrasar um pagamento nao acumula
// nem antecipa o proximo vencimento.
export function markClientPaymentReceived(fromNumber: string) {
  const today = spDateString();
  const nextDueDate = addMonthsToDateString(today, 1);
  const current = getClientBilling(fromNumber);
  db.prepare(
    `INSERT INTO client_billing (from_number, monthly_fee, next_due_date, last_payment_date) VALUES (?, ?, ?, ?)
     ON CONFLICT(from_number) DO UPDATE SET next_due_date = excluded.next_due_date, last_payment_date = excluded.last_payment_date`
  ).run(fromNumber, current?.monthly_fee ?? null, nextDueDate, today);
}

export function deleteClientBilling(fromNumber: string) {
  db.prepare(`DELETE FROM client_billing WHERE from_number = ?`).run(fromNumber);
}
