// Card 22, parte 1: agenda financeira -- recorte, coleta das quatro fontes, "em aberto", total e texto. Tudo somente leitura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import { createRecurringExpense } from "../../src/expenses/recurring";
import { createBillAlert } from "../../src/bills/service";
import { DEFAULT_FINANCE_DAYS, resolveAgendaRange } from "../../src/agenda/range";
import { dueDateInMonth, listFinanceItems, MAX_FINANCE_ITEMS, monthsInRange, parseInstallmentLabel } from "../../src/agenda/finance";
import { financeItemLine, formatFinanceAgenda, openItemLine } from "../../src/agenda/financeFormat";

const at = (iso: string) => new Date(iso).getTime();
const MON = new Date(at("2026-10-19T10:00:00-03:00")); // segunda 19/10/2026

let seq = 0;
const user = () => `55110009${String(100 + seq++)}`;

function expenseRow(n: string, description: string, amount: number, date: string, fixed?: { source: string; refId: number }) {
  db.prepare(`INSERT INTO expenses (from_number, amount, description, category_id, payment_method_id, date, created_at, fixed_source, fixed_ref_id) VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'), ?, ?)`).run(
    n,
    amount,
    description,
    date,
    fixed?.source ?? null,
    fixed?.refId ?? null
  );
}

const oldBill = (id: number) => db.prepare(`UPDATE bill_alerts SET created_at = '2026-01-01 00:00:00' WHERE id = ?`).run(id);

function rangeOf(params: Parameters<typeof resolveAgendaRange>[0], now = MON) {
  const resolved = resolveAgendaRange({ ...params, scope: "finance" }, now);
  assert.ok(resolved.ok);
  return resolved.range;
}

test("parseInstallmentLabel: com sufixo, sem sufixo e sufixo malformado (vira lancamento futuro comum)", () => {
  assert.deepEqual(parseInstallmentLabel("Tênis (parcela 3/6)"), { name: "Tênis", number: 3, total: 6 });
  assert.equal(parseInstallmentLabel("Dentista"), null);
  assert.equal(parseInstallmentLabel("Tênis (parcela 7/6)"), null);
  assert.equal(parseInstallmentLabel("Tênis (parcela 0/6)"), null);
  assert.equal(parseInstallmentLabel(" (parcela 1/2)"), null);
  assert.equal(parseInstallmentLabel("Tênis (parcela 3/6) extra"), null);
});

test("monthsInRange e dueDateInMonth: cruza meses e ano; dia 29, 30 e 31 caem no ultimo dia do mes curto", () => {
  assert.deepEqual(monthsInRange("2026-10-19", "2026-11-18"), ["2026-10", "2026-11"]);
  assert.deepEqual(monthsInRange("2026-12-20", "2027-01-20"), ["2026-12", "2027-01"]);
  assert.deepEqual(monthsInRange("2026-10-19", "2026-11-01"), ["2026-10"], "fim exclusivo: 01/11 nao entra");
  assert.equal(dueDateInMonth(31, "2026-04"), "2026-04-30");
  assert.equal(dueDateInMonth(30, "2028-02"), "2028-02-29");
  assert.equal(dueDateInMonth(29, "2027-02"), "2027-02-28");
  assert.equal(dueDateInMonth(5, "2026-10"), "2026-10-05");
});

test("resolveAgendaRange (finance): 30 dias por padrao, nunca antes de hoje, mes futuro inteiro, defaultDays", () => {
  const padrao = rangeOf({});
  assert.deepEqual([padrao.startDate, padrao.endDate, padrao.label], ["2026-10-19", "2026-11-18", "próximos 30 dias"]);
  assert.equal(DEFAULT_FINANCE_DAYS, 30);
  const tres = resolveAgendaRange({ scope: "finance" }, MON, { defaultDays: 3 });
  assert.ok(tres.ok && tres.range.endDate === "2026-10-22");
  const semana = rangeOf({ week: "current" });
  assert.deepEqual([semana.startDate, semana.endDate], ["2026-10-19", "2026-10-26"]);
  const quinta = rangeOf({ week: "current" }, new Date(at("2026-10-22T10:00:00-03:00")));
  assert.deepEqual([quinta.startDate, quinta.endDate], ["2026-10-22", "2026-10-26"], "restante da semana a partir de hoje");
  const novembro = rangeOf({ month: "2026-11" });
  assert.deepEqual([novembro.startDate, novembro.endDate], ["2026-11-01", "2026-12-01"]);
  const outubro = rangeOf({ month: "2026-10" });
  assert.deepEqual([outubro.startDate, outubro.endDate], ["2026-10-19", "2026-11-01"], "mes corrente: so de hoje em diante");
  const passado = rangeOf({ month: "2026-08" });
  assert.equal(passado.startDate, passado.endDate, "mes passado: recorte vazio");
  const ontem = rangeOf({ date: "2026-10-10" });
  assert.equal(ontem.startDate, ontem.endDate);
  const escopoNormal = resolveAgendaRange({ month: "2026-08" }, MON);
  assert.ok(escopoNormal.ok && escopoNormal.range.startDate === "2026-08-01", "outros escopos nao mudam");
  assert.equal(resolveAgendaRange({ scope: "finance", month: "2026-13" }, MON).ok, false);
});

test("listFinanceItems: o cenario completo da semana -- gasto fixo, conta, parcela, intervalo, em aberto, total e 'sem valor'", () => {
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 99.9, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  const agua = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 20 });
  oldBill(agua.id);
  db.prepare(`UPDATE bill_alerts SET confirmed_month = '2026-09' WHERE id = ?`).run(agua.id); // o ciclo de setembro ja foi resolvido
  expenseRow(n, "Conta de água", 85, "2026-09-20", { source: "bill_alert", refId: agua.id });
  const luz = createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 10 });
  oldBill(luz.id);
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 2, asks_cycle = '2026-10-10' WHERE id = ?`).run(luz.id);
  const racao = createBillAlert({ fromNumber: n, name: "Ração", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = '2026-10-24' WHERE id = ?`).run(racao.id);
  expenseRow(n, "Tênis (parcela 2/6)", 120, "2026-10-19"); // hoje: ja e gasto lancado, nao entra
  expenseRow(n, "Tênis (parcela 3/6)", 120, "2026-10-22");
  expenseRow(n, "Tênis (parcela 4/6)", 120, "2026-11-22"); // fora da semana

  const result = listFinanceItems(n, rangeOf({ week: "current" }), MON);
  assert.deepEqual(result.items.map((i) => [i.date, i.kind, i.name, i.amount]), [
    ["2026-10-20", "recurring", "Internet", 99.9],
    ["2026-10-20", "bill", "Água", 85],
    ["2026-10-22", "installment", "Tênis", 120],
    ["2026-10-24", "bill", "Ração", null],
  ]);
  assert.equal(result.total, 304.9);
  assert.equal(result.withoutValue, 1);
  assert.equal(result.hiddenCount, 0);
  assert.deepEqual(result.openItems.map((o) => [o.name, o.dueDate, o.asks, o.maxAsks]), [["Luz", "2026-10-10", 2, 3]]);
  assert.equal(result.items[1].amountIsLast, true);
  assert.equal(result.items[2].installment?.number, 3);
  assert.equal(result.items[3].recurrence, "a cada 45 dias");
});

test("gasto fixo: ja lancado neste mes some de outubro e aparece em novembro; dia 31 em mes de 30 dias cai no dia 30; desativado e outro numero nao entram", () => {
  const n = user();
  const other = user();
  const aluguel = createRecurringExpense({ fromNumber: n, description: "Aluguel", amount: 900, categoryId: null, paymentMethodId: null, dayOfMonth: 25 });
  db.prepare(`UPDATE recurring_expenses SET last_run_month = '2026-10' WHERE id = ?`).run(aluguel.id);
  createRecurringExpense({ fromNumber: n, description: "Condomínio", amount: 400, categoryId: null, paymentMethodId: null, dayOfMonth: 31 });
  const velho = createRecurringExpense({ fromNumber: n, description: "Cancelado", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 22 });
  db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ?`).run(velho.id);
  createRecurringExpense({ fromNumber: other, description: "Do outro", amount: 77, categoryId: null, paymentMethodId: null, dayOfMonth: 22 });

  const out = listFinanceItems(n, rangeOf({ month: "2026-10" }), MON);
  assert.deepEqual(out.items.map((i) => [i.date, i.name]), [["2026-10-31", "Condomínio"]]);
  const nov = listFinanceItems(n, rangeOf({ month: "2026-11" }), MON);
  assert.deepEqual(nov.items.map((i) => [i.date, i.name]), [["2026-11-25", "Aluguel"], ["2026-11-30", "Condomínio"]], "dia 31 em novembro (30 dias) cai no dia 30");
  assert.equal(listFinanceItems(other, rangeOf({ month: "2026-11" }), MON).items.length, 1);
});

test("conta fixa: confirmada no ciclo nao aparece; sem historico de valor e 'valor a informar'; criada depois do vencimento nao fica em aberto; intervalo atrasado fica em aberto", () => {
  const n = user();
  const paga = createBillAlert({ fromNumber: n, name: "Paga", dayOfMonth: 5 });
  oldBill(paga.id);
  db.prepare(`UPDATE bill_alerts SET confirmed_month = '2026-10' WHERE id = ?`).run(paga.id);
  const nova = createBillAlert({ fromNumber: n, name: "Nova", dayOfMonth: 5 }); // criada "agora" (depois do dia 5): nao ha ciclo em aberto
  assert.ok(nova);
  const atrasada = createBillAlert({ fromNumber: n, name: "Atrasada", intervalDays: 30 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = '2026-10-15' WHERE id = ?`).run(atrasada.id);
  const out = listFinanceItems(n, rangeOf({ month: "2026-10" }), MON);
  assert.deepEqual(out.items, [], "Paga ja foi resolvida em outubro; Nova so vence em novembro; Atrasada nao e 'a vencer'");
  assert.deepEqual(out.openItems.map((o) => [o.name, o.dueDate, o.asks]), [["Atrasada", "2026-10-15", 0]]);
  const nov = listFinanceItems(n, rangeOf({ month: "2026-11" }), MON);
  assert.deepEqual(nov.items.map((i) => [i.date, i.name, i.amount]), [["2026-11-05", "Nova", null], ["2026-11-05", "Paga", null]]);
  assert.equal(nov.withoutValue, 2);
  assert.equal(nov.total, 0);
});

test("lancamento futuro sem sufixo vira '(lancamento futuro)'; compra apagada some junto; ordem: gasto fixo, conta, parcela no mesmo dia", () => {
  const n = user();
  expenseRow(n, "Dentista", 200, "2026-10-28");
  expenseRow(n, "Sofá (parcela 1/x)", 50, "2026-10-28"); // malformado: tambem e um lancamento futuro
  createRecurringExpense({ fromNumber: n, description: "Zumba", amount: 60, categoryId: null, paymentMethodId: null, dayOfMonth: 28 });
  const b = createBillAlert({ fromNumber: n, name: "Gás", dayOfMonth: 28 });
  oldBill(b.id);
  expenseRow(n, "Bike (parcela 2/3)", 90, "2026-10-28");
  const out = listFinanceItems(n, rangeOf({}), MON);
  assert.deepEqual(out.items.map((i) => i.kind), ["recurring", "bill", "installment", "future", "future"]);
  assert.deepEqual(out.items.filter((i) => i.kind === "future").map((i) => i.name), ["Dentista", "Sofá (parcela 1/x)"]);
  db.prepare(`DELETE FROM expenses WHERE from_number = ? AND description LIKE 'Bike%'`).run(n);
  assert.equal(listFinanceItems(n, rangeOf({}), MON).items.some((i) => i.name === "Bike"), false);
});

test("teto: mais de 30 itens mostra 30, conta os escondidos e o total soma todos", () => {
  const n = user();
  for (let i = 0; i < 35; i++) expenseRow(n, `Compra ${String(i).padStart(2, "0")}`, 10, "2026-10-30");
  const out = listFinanceItems(n, rangeOf({}), MON);
  assert.equal(out.items.length, MAX_FINANCE_ITEMS);
  assert.equal(out.hiddenCount, 5);
  assert.equal(out.total, 350);
  const text = formatFinanceAgenda({ title: "T", finance: out, today: "2026-10-19", link: "https://painel", emptyText: "vazio" });
  assert.match(text, /…e mais 5 itens\. Veja tudo no painel: https:\/\/painel/);
  assert.match(text, /Total previsto: R\$ 350,00/);
  assert.equal(text.split("\n").filter((l) => l.startsWith("🧾")).length, 30);
});

test("gasto fixo que o servidor ainda nao lancou (Card 19) aparece em 'Em aberto' com o valor, sem entrar no total", () => {
  const n = user();
  const recurring = createRecurringExpense({ fromNumber: n, description: "Academia", amount: 120, categoryId: null, paymentMethodId: null, dayOfMonth: 17 });
  db.prepare(`UPDATE recurring_expenses SET created_at = '2026-01-01 00:00:00' WHERE id = ?`).run(recurring.id);
  const out = listFinanceItems(n, rangeOf({}), MON);
  assert.deepEqual(out.openItems.map((o) => [o.kind, o.name, o.dueDate, o.amount]), [["recurring", "Academia", "2026-10-17", 120]]);
  assert.deepEqual(out.items.map((i) => [i.date, i.name]), [["2026-11-17", "Academia"]], "o vencimento de outubro ja passou; o proximo (17/11) esta nos 30 dias");
  assert.equal(out.total, 120, "so o 17/11 conta; o atrasado de outubro fica fora do total");
});

test("texto: contrato da semana, vazio, so em aberto, avisos, truncamento e o rotulo de cada tipo", () => {
  const n = user();
  createRecurringExpense({ fromNumber: n, description: "Internet", amount: 99.9, categoryId: null, paymentMethodId: null, dayOfMonth: 20 });
  const agua = createBillAlert({ fromNumber: n, name: "Água", dayOfMonth: 20 });
  oldBill(agua.id);
  db.prepare(`UPDATE bill_alerts SET confirmed_month = '2026-09' WHERE id = ?`).run(agua.id);
  expenseRow(n, "Conta", 85, "2026-09-20", { source: "bill_alert", refId: agua.id });
  const luz = createBillAlert({ fromNumber: n, name: "Luz", dayOfMonth: 10 });
  oldBill(luz.id);
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 2, asks_cycle = '2026-10-10' WHERE id = ?`).run(luz.id);
  const racao = createBillAlert({ fromNumber: n, name: "Ração", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET next_due_date = '2026-10-24' WHERE id = ?`).run(racao.id);
  expenseRow(n, "Tênis (parcela 3/6)", 120, "2026-10-22");
  const range = rangeOf({ week: "current" });
  const text = formatFinanceAgenda({ title: "💳 Agenda financeira — semana (19/10 a 25/10)", finance: listFinanceItems(n, range, MON), today: "2026-10-19", link: "L", emptyText: "Nada a pagar neste período. 🎉" });
  assert.equal(
    text,
    [
      "💳 Agenda financeira — semana (19/10 a 25/10)",
      "",
      "⚠️ Em aberto",
      "• Luz · venceu dia 10, aguardando sua resposta (2 de 3 avisos)",
      "",
      "Amanhã · ter 20/10",
      "🔁 Internet · R$ 99,90 (lança sozinho)",
      "📌 Água · ≈ R$ 85,00 (último)",
      "",
      "Qui 22/10",
      "🧾 Tênis · parcela 3/6 · R$ 120,00",
      "",
      "Sáb 24/10",
      "📌 Ração · valor a informar (a cada 45 dias)",
      "",
      "Total previsto: R$ 304,90",
      "+ 1 sem valor definido",
    ].join("\n")
  );

  const vazio = formatFinanceAgenda({ title: "T", finance: { openItems: [], items: [], hiddenCount: 0, total: 0, withoutValue: 0 }, today: "2026-10-19", link: "L", emptyText: "Nada a pagar neste período. 🎉" });
  assert.equal(vazio, "T\n\nNada a pagar neste período. 🎉");
  const soAberto = formatFinanceAgenda({
    title: "T",
    finance: { openItems: [{ kind: "bill", name: "Luz", dueDate: "2026-09-10", amount: null, asks: 0, maxAsks: 3 }], items: [], hiddenCount: 0, total: 0, withoutValue: 0 },
    today: "2026-10-19",
    link: "L",
    emptyText: "vazio",
  });
  assert.equal(soAberto, "T\n\n⚠️ Em aberto\n• Luz · venceu dia 10/09, aguardando sua resposta");
  assert.equal(formatFinanceAgenda({ title: "T", finance: { openItems: [], items: [], hiddenCount: 0, total: 0, withoutValue: 0 }, today: "2026-10-19", link: "L", emptyText: "vazio", notice: "Aviso" }), "Aviso\n\nT\n\nvazio");

  assert.equal(openItemLine({ kind: "recurring", name: "Academia", dueDate: "2026-10-17", amount: 120, asks: 0, maxAsks: 3 }, "2026-10-19"), "• Academia · R$ 120,00 · venceu dia 17, ainda não lançado (lança sozinho)");
  assert.equal(financeItemLine({ date: "2026-10-30", kind: "future", name: "Dentista", amount: 200, amountIsLast: false }), "🧾 Dentista · R$ 200,00 (lançamento futuro)");
  assert.equal(financeItemLine({ date: "2026-10-30", kind: "bill", name: "Ração", amount: 80, amountIsLast: true, recurrence: "a cada 45 dias" }), "📌 Ração · ≈ R$ 80,00 (último · a cada 45 dias)");
  assert.equal(financeItemLine({ date: "2026-10-30", kind: "bill", name: "A".repeat(80), amount: null, amountIsLast: false }), `📌 ${"A".repeat(59)}… · valor a informar`, "titulo truncado em 60");
  const semTotal = formatFinanceAgenda({
    title: "T",
    finance: { openItems: [], items: [{ date: "2026-10-30", kind: "bill", name: "Luz", amount: null, amountIsLast: false }], hiddenCount: 0, total: 0, withoutValue: 1 },
    today: "2026-10-19",
    link: "L",
    emptyText: "vazio",
  });
  assert.match(semTotal, /\n1 sem valor definido$/);
  assert.doesNotMatch(semTotal, /Total previsto/);
});

test("somente leitura: listar a agenda financeira nao muda nenhuma tabela", () => {
  const n = user();
  const bill = createBillAlert({ fromNumber: n, name: "Luz leitura", dayOfMonth: 10 });
  oldBill(bill.id);
  createRecurringExpense({ fromNumber: n, description: "Net leitura", amount: 10, categoryId: null, paymentMethodId: null, dayOfMonth: 25 });
  expenseRow(n, "Futuro leitura", 5, "2026-10-30");
  const snapshot = () => JSON.stringify([db.prepare(`SELECT * FROM bill_alerts WHERE from_number = ?`).all(n), db.prepare(`SELECT * FROM recurring_expenses WHERE from_number = ?`).all(n), db.prepare(`SELECT * FROM expenses WHERE from_number = ?`).all(n), db.prepare(`SELECT COUNT(*) AS c FROM activity_log`).get()]);
  const before = snapshot();
  listFinanceItems(n, rangeOf({}), MON);
  listFinanceItems(n, rangeOf({ month: "2026-11" }), MON);
  assert.equal(snapshot(), before);
});
