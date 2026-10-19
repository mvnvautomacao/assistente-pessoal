// Card 20 (RN01, RN02, RN05, RF01, RF03): agenda numerada e "ultima lista mostrada" unica (gastos, entradas, agenda).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENDA_ACTION_HINT, formatAgenda } from "../../src/agenda/format";
import {
  clearLastShown,
  clearLastShownAgenda,
  getLastShown,
  getLastShownAgenda,
  setLastShown,
  setLastShownAgenda,
} from "../../src/lists/lastShown";
import { clearLastShownExpenses, getLastShownExpenses, getLastShownLabel, setLastShownExpenses } from "../../src/expenses/listCache";
import { clearLastShownIncomes, getLastShownIncomes, setLastShownIncomes } from "../../src/incomes/listCache";

const THU = new Date("2026-10-15T10:00:00-03:00");
const base = { now: THU, startDate: "2026-10-15", link: "https://painel.test", emptyText: "Nada agendado." };
const event = (id: number, title: string, start: string, end: string, location: string | null = null) => ({ id, title, start, end, location });
const reminder = (id: number, message: string, due_at: string, sent = 0) => ({ id, message, due_at, sent });

test("formatAgenda: numeracao continua entre os dias, eventos e lembretes na mesma sequencia, e shown na mesma ordem", () => {
  const out = formatAgenda({
    ...base,
    title: "📅 Agenda — semana",
    mode: "period",
    events: [event(12, "Dentista", "2026-10-17T10:00:00-03:00", "2026-10-17T11:00:00-03:00", "Clínica"), event(7, "Reunião", "2026-10-15T09:30:00-03:00", "2026-10-15T11:00:00-03:00")],
    reminders: [reminder(31, "Ligar", "2026-10-15T18:00:00-03:00"), reminder(40, "Remédio", "2026-10-16T08:00:00-03:00")],
  });
  assert.equal(
    out.text,
    `📅 Agenda — semana\n\nHoje · qui 15/10\n1. agora 09:30–11:00 Reunião\n2. ⏰ 18:00 Ligar\nAmanhã · sex 16/10\n3. ⏰ 08:00 Remédio\nSáb 17/10\n4. 10:00–11:00 Dentista · Clínica\n\n${AGENDA_ACTION_HINT}`
  );
  assert.deepEqual(out.shown, [
    { kind: "event", id: 7 },
    { kind: "reminder", id: 31 },
    { kind: "reminder", id: 40 },
    { kind: "event", id: 12 },
  ]);
  assert.ok(!out.text.includes("•"), "o marcador some");
});

test("formatAgenda: lembrete ja tocado (✔️) e evento em andamento tambem recebem numero; empate de minuto: evento antes, depois por id", () => {
  const out = formatAgenda({
    ...base,
    title: "T",
    mode: "day",
    events: [event(5, "Reunião", "2026-10-15T09:00:00-03:00", "2026-10-15T11:00:00-03:00")],
    reminders: [reminder(9, "B", "2026-10-15T09:00:00-03:00"), reminder(3, "A", "2026-10-15T09:00:00-03:00"), reminder(2, "Remédio", "2026-10-15T07:00:00-03:00", 1)],
  });
  assert.equal(out.text.split("\n").slice(2, 6).join("|"), "1. ✔️ 07:00 Remédio|2. agora 09:00–11:00 Reunião|3. ⏰ 09:00 A|4. ⏰ 09:00 B");
  assert.deepEqual(out.shown.map((s) => `${s.kind}${s.id}`), ["reminder2", "event5", "reminder3", "reminder9"]);
});

test("formatAgenda: so os itens numerados (ate o teto de 30) entram em shown; os escondidos ficam de fora", () => {
  const many = Array.from({ length: 33 }, (_, i) => reminder(100 + i, `Item ${i}`, `2026-10-16T${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00-03:00`));
  const out = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: many });
  assert.equal(out.shown.length, 30);
  assert.equal(out.shown[29].id, 129);
  assert.ok(out.text.includes("30. ⏰ "));
  assert.ok(!out.text.includes("31. "));
  assert.ok(out.text.includes("…e mais 3 itens. Veja tudo no painel: https://painel.test"));
});

test("formatAgenda: dica de acao no fim (depois do rodape), desligavel; lista vazia nao tem numeracao, dica nem shown", () => {
  const one = [reminder(1, "A", "2026-10-16T09:00:00-03:00")];
  const withFooter = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: one, footer: "rodape" });
  assert.equal(withFooter.text, `T\n\n1. ⏰ 09:00 A\n\nrodape\n\n${AGENDA_ACTION_HINT}`);
  assert.equal(AGENDA_ACTION_HINT, 'Pra mexer em um item: "edita o 2" ou "cancela o 3".');
  const off = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: one, actionHint: "" });
  assert.equal(off.text, "T\n\n1. ⏰ 09:00 A");
  const empty = formatAgenda({ ...base, title: "T", mode: "day", events: [], reminders: [] });
  assert.deepEqual(empty, { text: "T\n\nNada agendado.", shown: [] });
});

test("lastShown: uma lista por vez -- guardar uma invalida as outras; o numero vale pra ULTIMA lista", () => {
  const n = "5511900020001";
  setLastShownExpenses(n, [1, 2, 3], "ultimos gastos");
  assert.deepEqual(getLastShownExpenses(n), [1, 2, 3]);
  assert.equal(getLastShownLabel(n), "ultimos gastos");
  setLastShownAgenda(n, [{ kind: "event", id: 9 }, { kind: "reminder", id: 4 }]);
  assert.equal(getLastShownExpenses(n), null, "a agenda invalidou a de gastos");
  assert.equal(getLastShownLabel(n), null);
  assert.deepEqual(getLastShownAgenda(n), [{ kind: "event", id: 9 }, { kind: "reminder", id: 4 }]);
  setLastShownIncomes(n, [7], "entradas");
  assert.equal(getLastShownAgenda(n), null, "as entradas invalidaram a agenda");
  assert.deepEqual(getLastShownIncomes(n), [7]);
  setLastShownExpenses(n, [5]);
  assert.equal(getLastShownIncomes(n), null);
  assert.equal(getLastShown(n)?.kind, "expense");
});

test("lastShown: limpar por tipo so limpa a lista daquele tipo; limpar sem tipo limpa qualquer uma", () => {
  const n = "5511900020002";
  setLastShownAgenda(n, [{ kind: "event", id: 1 }]);
  clearLastShownExpenses(n);
  clearLastShownIncomes(n);
  assert.deepEqual(getLastShownAgenda(n), [{ kind: "event", id: 1 }], "limpar gastos/entradas nao mexe na agenda");
  clearLastShownAgenda(n);
  assert.equal(getLastShownAgenda(n), null);
  setLastShown(n, { kind: "income", ids: [1] });
  clearLastShownAgenda(n);
  assert.deepEqual(getLastShownIncomes(n), [1], "limpar a agenda nao mexe nas entradas");
  clearLastShown(n);
  assert.equal(getLastShown(n), null);
  clearLastShown(n, "income"); // sem lista nenhuma: nao quebra
});

test("lastShown: isolamento por numero e validade de 10 minutos", (t) => {
  const a = "5511900020003";
  const b = "5511900020004";
  const realNow = Date.now();
  setLastShownAgenda(a, [{ kind: "reminder", id: 1 }]);
  assert.equal(getLastShownAgenda(b), null);
  t.mock.method(Date, "now", () => realNow + 10 * 60 * 1000 - 1000);
  assert.ok(getLastShownAgenda(a), "ainda vale perto dos 10 min");
  t.mock.method(Date, "now", () => realNow + 10 * 60 * 1000 + 1000);
  assert.equal(getLastShownAgenda(a), null, "expirou");
  assert.equal(getLastShown(a), null);
});
