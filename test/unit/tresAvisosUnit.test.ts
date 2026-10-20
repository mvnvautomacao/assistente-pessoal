// Card 21, parte 2: pecas da regra dos 3 avisos sem resposta (contador por ciclo, fechamento, texto do ultimo aviso, fila).
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import {
  BILL_MAX_UNANSWERED_ASKS,
  billCycleKey,
  closeBillAlertUnanswered,
  confirmBillAlertPaid,
  createBillAlert,
  getBillAlertById,
  markBillAlertAsked,
  resetBillAlertAsks,
  restoreBillAlertFields,
  unansweredAsksInCycle,
  updateBillAlert,
} from "../../src/bills/service";
import { buildBillAlertQuestion, lastAskLine, nextAskLabel } from "../../src/bills/checkinReply";
import { clearPendingBillCheckin, getPendingBillCheckin, removeBillFromCheckin, setPendingBillCheckin } from "../../src/bills/pendingCheckin";

const A = "551100080001";
const B = "551100080002";

test("migracao: bill_alerts ganhou unanswered_asks (padrao 0) e asks_cycle (nulo); alerta novo nasce zerado", () => {
  const columns = db.prepare(`PRAGMA table_info(bill_alerts)`).all() as { name: string; dflt_value: string | null; notnull: number }[];
  const asks = columns.find((c) => c.name === "unanswered_asks");
  assert.ok(asks && asks.notnull === 1 && asks.dflt_value === "0");
  assert.ok(columns.some((c) => c.name === "asks_cycle"));
  const bill = createBillAlert({ fromNumber: A, name: "Zero", dayOfMonth: 10 });
  assert.deepEqual([bill.unanswered_asks, bill.asks_cycle], [0, null]);
  assert.equal(BILL_MAX_UNANSWERED_ASKS, 3);
});

test("billCycleKey: dia do mes = data do vencimento (inclusive do mes anterior); intervalo = next_due_date", () => {
  const luz = createBillAlert({ fromNumber: A, name: "Luz key", dayOfMonth: 10 });
  assert.equal(billCycleKey(luz, "2026-11-12"), "2026-11-10");
  assert.equal(billCycleKey(luz, "2026-11-05"), "2026-10-10");
  const dia31 = createBillAlert({ fromNumber: A, name: "Dia 31", dayOfMonth: 31 });
  assert.equal(billCycleKey(dia31, "2026-05-02"), "2026-04-30");
  const racao = createBillAlert({ fromNumber: A, name: "Racao key", intervalDays: 45 });
  assert.equal(billCycleKey(racao, "2026-12-30"), racao.next_due_date);
});

test("markBillAlertAsked soma 1 por aviso no mesmo ciclo e recomeca em 1 quando o ciclo muda; unansweredAsksInCycle le o ciclo de hoje", () => {
  const bill = createBillAlert({ fromNumber: A, name: "Luz conta", dayOfMonth: 10 });
  markBillAlertAsked(A, bill.id, "2026-11-10");
  markBillAlertAsked(A, bill.id, "2026-11-11");
  let row = getBillAlertById(A, bill.id)!;
  assert.deepEqual([row.unanswered_asks, row.asks_cycle, row.last_asked_date], [2, "2026-11-10", "2026-11-11"]);
  assert.equal(unansweredAsksInCycle(row, "2026-11-12"), 2);
  assert.equal(unansweredAsksInCycle(row, "2026-12-10"), 0, "ciclo novo: 0");
  markBillAlertAsked(A, bill.id, "2026-12-10");
  row = getBillAlertById(A, bill.id)!;
  assert.deepEqual([row.unanswered_asks, row.asks_cycle], [1, "2026-12-10"]);
  markBillAlertAsked(A, 999999, "2026-12-10"); // alerta inexistente: nao quebra
});

test("closeBillAlertUnanswered: dia do mes confirma o mes do CICLO (nao o de hoje); intervalo soma o intervalo a hoje; limpa soneca e contador", () => {
  const luz = createBillAlert({ fromNumber: A, name: "Luz fecha", dayOfMonth: 30 });
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 3, asks_cycle = '2026-10-30', snoozed_until = '2026-11-02' WHERE id = ?`).run(luz.id);
  assert.equal(closeBillAlertUnanswered(A, luz.id, "2026-11-02"), true);
  let row = getBillAlertById(A, luz.id)!;
  assert.deepEqual([row.confirmed_month, row.unanswered_asks, row.asks_cycle, row.snoozed_until], ["2026-10", 0, null, null], "o ciclo e o de outubro (30/10), mesmo fechando em novembro");

  const racao = createBillAlert({ fromNumber: A, name: "Racao fecha", intervalDays: 45 });
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 3, asks_cycle = next_due_date, snoozed_until = '2026-12-04' WHERE id = ?`).run(racao.id);
  assert.equal(closeBillAlertUnanswered(A, racao.id, "2026-12-04"), true);
  row = getBillAlertById(A, racao.id)!;
  assert.deepEqual([row.next_due_date, row.unanswered_asks, row.snoozed_until], ["2027-01-18", 0, null]);

  assert.equal(closeBillAlertUnanswered(A, 999999, "2026-12-04"), false);
  const other = createBillAlert({ fromNumber: B, name: "De outro", dayOfMonth: 5 });
  assert.equal(closeBillAlertUnanswered(A, other.id, "2026-12-04"), false, "nao fecha alerta de outro numero");
});

test("o contador zera em: resetBillAlertAsks, confirmar (pago/pulado), editar e desfazer a edicao", () => {
  const bill = createBillAlert({ fromNumber: A, name: "Zera", dayOfMonth: 10 });
  const set = () => db.prepare(`UPDATE bill_alerts SET unanswered_asks = 2, asks_cycle = '2026-11-10' WHERE id = ?`).run(bill.id);
  const asks = () => getBillAlertById(A, bill.id)!.unanswered_asks;
  set();
  resetBillAlertAsks(A, bill.id);
  assert.equal(asks(), 0);
  set();
  confirmBillAlertPaid(A, bill.id, "2026-11-12");
  assert.equal(asks(), 0);
  set();
  updateBillAlert(A, bill.id, { name: "Zera 2" });
  assert.equal(asks(), 0);
  set();
  restoreBillAlertFields(A, bill.id, { name: "Zera", recurrenceType: "day_of_month", dayOfMonth: 10, intervalDays: null, nextDueDate: null });
  assert.equal(asks(), 0);
  const racao = createBillAlert({ fromNumber: A, name: "Zera intervalo", intervalDays: 10 });
  db.prepare(`UPDATE bill_alerts SET unanswered_asks = 2, asks_cycle = next_due_date WHERE id = ?`).run(racao.id);
  confirmBillAlertPaid(A, racao.id, "2026-11-12");
  assert.equal(getBillAlertById(A, racao.id)!.unanswered_asks, 0);
});

test("buildBillAlertQuestion: com isLastAsk acrescenta a linha do ultimo aviso (intervalo e dia do mes); sem, o texto de sempre", () => {
  const interval = { name: "Ração", recurrenceType: "interval" as const, intervalDays: 45 };
  assert.equal(nextAskLabel("interval", 45), "daqui a 45 dias");
  assert.equal(nextAskLabel("day_of_month", null), "mês que vem, no dia certo");
  assert.equal(lastAskLine(interval), "⚠️ Último aviso: se eu não tiver resposta, considero resolvido (sem lançar gasto) e te aviso de novo daqui a 45 dias.");
  assert.equal(
    buildBillAlertQuestion({ ...interval, isLastAsk: true }),
    "📌 Hora de: Ração.\n1 ✅ Já resolvi\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ Não vou fazer agora (pular)\n⚠️ Último aviso: se eu não tiver resposta, considero resolvido (sem lançar gasto) e te aviso de novo daqui a 45 dias."
  );
  assert.ok(!buildBillAlertQuestion(interval).includes("Último aviso"));
  assert.ok(buildBillAlertQuestion({ name: "Luz", recurrenceType: "day_of_month", isLastAsk: true }).endsWith("te aviso de novo mês que vem, no dia certo."));
});

test("removeBillFromCheckin: o da vez passa pro proximo, o da fila e retirado, o unico limpa; outro alerta ou numero sem pendencia nao mexe", () => {
  const item = (id: number) => ({ billAlertId: id, name: `Conta ${id}`, recurrenceType: "day_of_month" as const, intervalDays: null });
  clearPendingBillCheckin(A);
  setPendingBillCheckin(A, { ...item(1), queued: [item(2), item(3)] });
  removeBillFromCheckin(A, 2);
  assert.deepEqual(getPendingBillCheckin(A)?.queued.map((q) => q.billAlertId), [3]);
  removeBillFromCheckin(A, 99);
  assert.equal(getPendingBillCheckin(A)?.billAlertId, 1);
  removeBillFromCheckin(A, 1);
  const head = getPendingBillCheckin(A)!;
  assert.deepEqual([head.billAlertId, head.step, head.queued.length], [3, "ask_paid", 0]);
  removeBillFromCheckin(A, 3);
  assert.equal(getPendingBillCheckin(A), null);
  removeBillFromCheckin(A, 3); // sem pendencia: nao quebra
  assert.equal(getPendingBillCheckin(B), null);
});
