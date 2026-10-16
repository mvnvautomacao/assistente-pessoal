// Card 15 (RN07 a RN09): regras puras da edicao de alerta de conta fixa.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBillChanges,
  billAlertLine,
  billChanges,
  BillParams,
  hasBillChangeRequest,
  nextOccurrenceDate,
  recurrenceText,
} from "../../src/bills/editPlan";
import { validateFieldAnswer, validateIntervalAnswer } from "../../src/fieldMenu/validate";
import { getFieldDef } from "../../src/fieldMenu/registry";

const TODAY = "2026-10-14";
const dayBill: BillParams = { name: "Água", recurrenceType: "day_of_month", dayOfMonth: 5, intervalDays: null, nextDueDate: null };
const intervalBill: BillParams = { name: "Ração", recurrenceType: "interval", dayOfMonth: null, intervalDays: 45, nextDueDate: "2026-11-01" };

test("recurrenceText e billAlertLine descrevem os dois tipos", () => {
  assert.equal(recurrenceText(dayBill), "todo dia 5");
  assert.equal(recurrenceText(intervalBill), "a cada 45 dias");
  assert.equal(billAlertLine(dayBill), "Água — todo dia 5");
  assert.equal(billAlertLine(intervalBill), "Ração — a cada 45 dias · próximo aviso 01/11");
});

test("applyBillChanges: nome, dia do mes, intervalo e troca de tipo", () => {
  const renamed = applyBillChanges(dayBill, { name: "  Conta   de água  " }, TODAY);
  assert.deepEqual(renamed.ok && renamed.proposed.name, "Conta de água");

  const day = applyBillChanges(intervalBill, { dayOfMonth: 8 }, TODAY);
  assert.ok(day.ok);
  assert.deepEqual(day.proposed, { name: "Ração", recurrenceType: "day_of_month", dayOfMonth: 8, intervalDays: null, nextDueDate: null });

  const interval = applyBillChanges(dayBill, { intervalDays: 30 }, TODAY);
  assert.ok(interval.ok);
  assert.equal(interval.proposed.recurrenceType, "interval");
  assert.equal(interval.proposed.nextDueDate, "2026-11-13", "o intervalo recomeca a contar de hoje");

  const withDate = applyBillChanges(dayBill, { intervalDays: 30, nextDueDate: "2026-12-01" }, TODAY);
  assert.ok(withDate.ok && withDate.proposed.nextDueDate === "2026-12-01");
});

test("applyBillChanges: validacoes (dia, intervalo, data, nome longo, so um tipo)", () => {
  const error = (request: Parameters<typeof applyBillChanges>[1], from = dayBill) => {
    const result = applyBillChanges(from, request, TODAY);
    return result.ok ? null : result.error;
  };
  assert.match(error({ dayOfMonth: 0 })!, /1 a 31/);
  assert.match(error({ dayOfMonth: 32 })!, /1 a 31/);
  assert.match(error({ dayOfMonth: 2.5 })!, /1 a 31/);
  assert.match(error({ intervalDays: 0 })!, /entre 1 e 3650/);
  assert.match(error({ intervalDays: 3651 })!, /entre 1 e 3650/);
  assert.equal(applyBillChanges(dayBill, { intervalDays: 3650 }, TODAY).ok, true);
  assert.match(error({ dayOfMonth: 5, intervalDays: 30 })!, /Escolhe um só/);
  assert.equal(error({ nextDueDate: "2026-10-13" }, intervalBill), "A data precisa ser de hoje em diante.");
  assert.equal(applyBillChanges(intervalBill, { nextDueDate: TODAY }, TODAY).ok, true, "hoje vale");
  assert.match(error({ nextDueDate: "2026-02-30" }, intervalBill)!, /Não entendi essa data/);
  assert.match(error({ nextDueDate: "2026-11-01" })!, /Só os alertas por intervalo/);
  assert.match(error({ name: "x".repeat(101) })!, /muito longo/);
  const blank = applyBillChanges(dayBill, { name: "   " }, TODAY);
  assert.ok(blank.ok && blank.proposed.name === "Água", "nome em branco nao muda nada");
});

test("billChanges mostra so o que mudou, na ordem Nome, Recorrencia, Proximo aviso", () => {
  assert.deepEqual(billChanges(dayBill, dayBill), []);
  const both = applyBillChanges(dayBill, { name: "Luz", intervalDays: 30 }, TODAY);
  assert.ok(both.ok);
  assert.deepEqual(
    billChanges(dayBill, both.proposed).map((c) => [c.key, c.label, c.from, c.to]),
    [
      ["name", "Nome", "Água", "Luz"],
      ["recurrence", "Recorrência", "todo dia 5", "a cada 30 dias"],
      ["next_due", "Próximo aviso", "—", "13/11"],
    ]
  );
  const onlyNext = applyBillChanges(intervalBill, { nextDueDate: "2026-11-15" }, TODAY);
  assert.ok(onlyNext.ok);
  assert.deepEqual(billChanges(intervalBill, onlyNext.proposed).map((c) => [c.key, c.from, c.to]), [["next_due", "01/11", "15/11"]]);
  // dia 5 -> dia 5 nao e mudanca
  const same = applyBillChanges(dayBill, { dayOfMonth: 5 }, TODAY);
  assert.ok(same.ok);
  assert.deepEqual(billChanges(dayBill, same.proposed), []);
  // "—" tambem quando o proximo aviso some (intervalo -> dia do mes nao lista Proximo aviso)
  const toDay = applyBillChanges(intervalBill, { dayOfMonth: 5 }, TODAY);
  assert.ok(toDay.ok);
  assert.deepEqual(billChanges(intervalBill, toDay.proposed).map((c) => c.key), ["recurrence"]);
});

test("hasBillChangeRequest", () => {
  assert.equal(hasBillChangeRequest({}), false);
  assert.equal(hasBillChangeRequest({ name: "  " }), false);
  assert.equal(hasBillChangeRequest({ name: "Luz" }), true);
  assert.equal(hasBillChangeRequest({ dayOfMonth: 3 }), true);
  assert.equal(hasBillChangeRequest({ intervalDays: 3 }), true);
  assert.equal(hasBillChangeRequest({ nextDueDate: TODAY }), true);
});

test("nextOccurrenceDate: 'dia N' e 'dd/mm' valem a proxima vez que a data chega", () => {
  assert.equal(nextOccurrenceDate("dia 20", TODAY), "2026-10-20");
  assert.equal(nextOccurrenceDate("20", TODAY), "2026-10-20");
  assert.equal(nextOccurrenceDate("dia 14", TODAY), TODAY, "hoje conta");
  assert.equal(nextOccurrenceDate("dia 10", TODAY), "2026-11-10", "ja passou neste mes: proximo mes");
  assert.equal(nextOccurrenceDate("dia 31", "2026-11-05"), "2026-12-31", "mes sem dia 31 pula pro seguinte");
  assert.equal(nextOccurrenceDate("15/11", TODAY), "2026-11-15");
  assert.equal(nextOccurrenceDate("10/01", TODAY), "2027-01-10", "dd/mm que ja passou: ano que vem");
  assert.equal(nextOccurrenceDate("30/02", TODAY), null);
  assert.equal(nextOccurrenceDate("32", TODAY), null);
  assert.equal(nextOccurrenceDate("0", TODAY), null);
  assert.equal(nextOccurrenceDate("13/13", TODAY), null);
  assert.equal(nextOccurrenceDate("amanhã", TODAY), null, "outros formatos ficam pro leitor normal");
});

test("validateIntervalAnswer: numero, 'N dias', 'a cada N dias' e por extenso; fora da faixa erra", () => {
  for (const [text, value] of [["45", 45], ["45 dias", 45], ["a cada 45 dias", 45], ["A cada 1 dia", 1], ["quarenta e cinco", 45], ["30.", 30], ["3650", 3650]] as const) {
    assert.deepEqual(validateIntervalAnswer(text), { ok: true, value }, text);
  }
  for (const text of ["0", "3651", "banana", "", "dia 5", "1,5"]) {
    const result = validateIntervalAnswer(text);
    assert.equal(result.ok, false, text);
    assert.match((result as { error: string }).error, /entre 1 e 3650/);
  }
});

test("campo 'Proximo aviso' do menu aceita 'dia 20' como a proxima vez e rejeita lixo", async () => {
  const def = getFieldDef("bill_alert_interval", "next_due")!;
  const ok = await validateFieldAnswer(def, "15/11", "5511000000000");
  assert.equal(ok.ok, true);
  const bad = await validateFieldAnswer(def, "31/02", "5511000000000");
  assert.equal(bad.ok, false);
});
