import { db } from "../db";
import { spDateString } from "../timeSP";

export type BillingPlan = "mensal" | "anual";

export const PLAN_PRICES: Record<BillingPlan, number> = {
  mensal: 19.9,
  anual: 179.9,
};

const PLAN_MONTHS: Record<BillingPlan, number> = {
  mensal: 1,
  anual: 12,
};

export interface ClientBilling {
  from_number: string;
  monthly_fee: number | null;
  next_due_date: string | null; // YYYY-MM-DD
  last_payment_date: string | null;
  plan: BillingPlan | null;
}

export interface ClientPayment {
  id: number;
  from_number: string;
  plan: BillingPlan;
  amount: number;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  paid_at: string; // YYYY-MM-DD
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

// Lista de competencias ("YYYY-MM") cobertas por um pagamento, a partir do mes
// em que ele comecou a valer -- aproximacao de calendario (nao rateia dias),
// suficiente pra acompanhar "quais meses esse cliente ja pagou".
function monthsCoveredFrom(startDateStr: string, count: number): string[] {
  const [y, m] = startDateStr.slice(0, 7).split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = m - 1 + i;
    const yy = y + Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    months.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return months;
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

export function setClientBillingInfo(
  fromNumber: string,
  changes: { monthlyFee?: number | null; nextDueDate?: string | null; plan?: BillingPlan | null }
) {
  const current = getClientBilling(fromNumber);
  const monthlyFee = changes.monthlyFee !== undefined ? changes.monthlyFee : (current?.monthly_fee ?? null);
  const nextDueDate = changes.nextDueDate !== undefined ? changes.nextDueDate : (current?.next_due_date ?? null);
  const plan = changes.plan !== undefined ? changes.plan : (current?.plan ?? null);
  db.prepare(
    `INSERT INTO client_billing (from_number, monthly_fee, next_due_date, last_payment_date, plan) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(from_number) DO UPDATE SET monthly_fee = excluded.monthly_fee, next_due_date = excluded.next_due_date, plan = excluded.plan`
  ).run(fromNumber, monthlyFee, nextDueDate, current?.last_payment_date ?? null, plan);
}

// Registra um pagamento (mensal R$19,90 ou anual R$179,90): sempre conta a
// partir de HOJE (mesmo criterio ja usado nos alertas de conta por intervalo,
// ver bills/service.ts) -- atrasar um pagamento nao acumula nem antecipa o
// proximo vencimento. Grava tambem 1 linha no historico (client_payments) pra
// dar pra acompanhar mes a mes o que cada cliente ja pagou.
export function recordClientPayment(fromNumber: string, plan: BillingPlan) {
  const today = spDateString();
  const amount = PLAN_PRICES[plan];
  const periodEnd = addMonthsToDateString(today, PLAN_MONTHS[plan]);

  db.prepare(
    `INSERT INTO client_billing (from_number, monthly_fee, next_due_date, last_payment_date, plan) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(from_number) DO UPDATE SET monthly_fee = excluded.monthly_fee, next_due_date = excluded.next_due_date, last_payment_date = excluded.last_payment_date, plan = excluded.plan`
  ).run(fromNumber, amount, periodEnd, today, plan);

  db.prepare(
    `INSERT INTO client_payments (from_number, plan, amount, period_start, period_end, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(fromNumber, plan, amount, today, periodEnd, today);
}

export function getPaymentHistory(fromNumber: string): ClientPayment[] {
  return db
    .prepare(`SELECT * FROM client_payments WHERE from_number = ? ORDER BY period_start DESC, id DESC`)
    .all(fromNumber) as unknown as ClientPayment[];
}

// Competencias ("YYYY-MM") ja cobertas por algum pagamento desse cliente, mais
// recente primeiro, sem repetir -- usado pra mostrar "quais meses ja pagou".
export function getPaidMonthsForClient(fromNumber: string): string[] {
  const months = new Set<string>();
  for (const p of getPaymentHistory(fromNumber)) {
    for (const month of monthsCoveredFrom(p.period_start, PLAN_MONTHS[p.plan])) months.add(month);
  }
  return Array.from(months).sort().reverse();
}

export function deleteClientBilling(fromNumber: string) {
  db.prepare(`DELETE FROM client_billing WHERE from_number = ?`).run(fromNumber);
  db.prepare(`DELETE FROM client_payments WHERE from_number = ?`).run(fromNumber);
}
