// Revisao do Card 22: a consulta financeira de um cliente nao varre os gastos fixos de todos e so busca o ultimo valor das contas que entram no recorte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { createRecurringExpense, getDueRecurringExpenses, getMissedRecurringExpenses } from "../../src/expenses/recurring";
import { createBillAlert } from "../../src/bills/service";
import { resolveAgendaRange } from "../../src/agenda/range";
import { listFinanceItems } from "../../src/agenda/finance";

const MON = new Date("2026-10-19T10:00:00-03:00");

let seq = 0;
const user = () => `55110009${String(700 + seq++)}`;

function rangeOf() {
  const resolved = resolveAgendaRange({ scope: "finance" }, MON);
  assert.ok(resolved.ok);
  return resolved.range;
}

test("em aberto: o gasto fixo atrasado vem so do proprio cliente; sem filtro (cron) a varredura continua global", () => {
  const a = user();
  const b = user();
  for (const n of [a, b]) {
    const r = createRecurringExpense({ fromNumber: n, description: `Atrasado ${n}`, amount: 30, categoryId: null, paymentMethodId: null, dayOfMonth: 17 });
    db.prepare(`UPDATE recurring_expenses SET created_at = '2026-01-01 00:00:00' WHERE id = ?`).run(r.id);
  }
  const out = listFinanceItems(a, rangeOf(), MON);
  assert.deepEqual(out.openItems.map((o) => o.name), [`Atrasado ${a}`]);
  assert.deepEqual(getMissedRecurringExpenses("2026-10-19", 7, a).map((m) => m.recurring.from_number), [a]);
  assert.ok(getMissedRecurringExpenses("2026-10-19", 7).some((m) => m.recurring.from_number === b), "sem filtro (cron), todos continuam");
  assert.deepEqual(getDueRecurringExpenses("2026-10-17", b).map((r) => r.from_number), [b]);
  assert.ok(getDueRecurringExpenses("2026-10-17").length >= 2);
});

test("o ultimo valor da conta so e usado quando o alerta entra no recorte", () => {
  const n = user();
  const dentro = createBillAlert({ fromNumber: n, name: "Dentro", dayOfMonth: 25 });
  const fora = createBillAlert({ fromNumber: n, name: "Fora", intervalDays: 40 });
  db.prepare(`UPDATE bill_alerts SET created_at = '2026-01-01 00:00:00' WHERE id = ?`).run(dentro.id);
  db.prepare(`UPDATE bill_alerts SET next_due_date = '2027-03-01' WHERE id = ?`).run(fora.id); // muito alem dos 30 dias
  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at, fixed_source, fixed_ref_id) VALUES (?, 77, 'Conta dentro', NULL, NULL, '2026-09-25', datetime('now'), 'bill_alert', ?)`).run(n, dentro.id);
  const out = listFinanceItems(n, rangeOf(), MON);
  assert.deepEqual(out.items.map((i) => [i.name, i.amount]), [["Dentro", 77]]);
});
