// Card 19, parte 3: lembretes em rajada depois de uma queda (aviso de atraso e teto por rodada) e aviso de evento com os minutos reais.
import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import * as whatsappClient from "../../src/whatsapp/client";
import { ensureUserSeeded } from "../../src/expenses/service";
import { createReminder, getDueReminders, getReminderById } from "../../src/reminders/service";
import { MAX_REMINDERS_PER_ROUND, REMINDER_LATE_AFTER_MS, reminderText, sendDueReminders, SNOOZE_HINT } from "../../src/reminders/scheduler";
import { addEventExtraReminder, createEvent } from "../../src/events/service";
import { eventReminderLead, eventReminderPrefix, sendDueEventReminders } from "../../src/events/reminderScheduler";
import { db } from "../../src/db";

const at = (iso: string) => new Date(iso);

let seq = 0;
function user(): string {
  const n = `55110008900${String(seq++).padStart(2, "0")}`;
  ensureUserSeeded(n);
  return n;
}

function mockSend(t: TestContext) {
  const sent: { to: string; text: string }[] = [];
  let fail = false;
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    if (fail) throw new Error("Evolution fora do ar (simulado)");
    sent.push({ to, text });
  });
  return {
    sent,
    setFail: (value: boolean) => {
      fail = value;
    },
  };
}

const textsOf = (sent: { to: string; text: string }[], n: string) => sent.filter((m) => m.to === n).map((m) => m.text);

test("Card 19 (reproducao): sem teto, 25 lembretes vencidos durante a queda sairiam todos de uma vez, sem aviso de atraso", () => {
  const n = user();
  for (let i = 0; i < 25; i++) createReminder(n, `Lembrete ${i}`, new Date(Date.UTC(2026, 9, 15, 15, i)).toISOString());
  const all = getDueReminders(at("2026-10-19T09:00:00-03:00")).filter((r) => r.to_number === n);
  assert.equal(all.length, 25, "o servico sem limite devolve tudo (era o que o cron antigo enviava de uma vez)");
  const round = getDueReminders(at("2026-10-19T09:00:00-03:00"), MAX_REMINDERS_PER_ROUND).filter((r) => r.to_number === n);
  assert.equal(round.length, 10, "com o teto, so 10 por rodada");
});

test("Card 19: 25 lembretes vencidos -- 10 por minuto, do mais antigo ao mais novo, todos com 'atrasado' quando passam de 10 min", async (t) => {
  const { sent } = mockSend(t);
  db.exec(`UPDATE reminders SET sent = 1`); // um teste nao enxerga os lembretes do anterior
  const n = user();
  const base = at("2026-10-15T20:00:00-03:00").getTime();
  // criados fora de ordem pra provar a ordenacao por horario
  const order = [...Array(25).keys()].reverse();
  for (const i of order) createReminder(n, `Lembrete ${String(i).padStart(2, "0")}`, new Date(base + i * 60_000).toISOString());
  const now = at("2026-10-19T09:00:00-03:00");

  assert.equal(await sendDueReminders(now), 10);
  assert.deepEqual(
    textsOf(sent, n).map((x) => x.split("\n")[0]),
    [...Array(10).keys()].map((i) => `🔔 Lembrete: Lembrete ${String(i).padStart(2, "0")}`),
    "os 10 mais antigos primeiro"
  );
  assert.ok(textsOf(sent, n).every((x) => x.includes("⏰ (atrasado: era pra qui 15/10 às 20:")), "todos com a linha de atraso");
  assert.equal(await sendDueReminders(at("2026-10-19T09:01:00-03:00")), 10);
  assert.equal(await sendDueReminders(at("2026-10-19T09:02:00-03:00")), 5);
  assert.equal(await sendDueReminders(at("2026-10-19T09:03:00-03:00")), 0);
  assert.equal(textsOf(sent, n).length, 25);
  assert.equal(new Set(textsOf(sent, n)).size, 25, "nenhum duplicado");
  assert.equal(textsOf(sent, n)[24].split("\n")[0], "🔔 Lembrete: Lembrete 24");
});

test("Card 19: lembrete em dia (ate 10 min de atraso) mantem o texto de sempre; acima disso ganha a linha de atraso entre o texto e a dica", async (t) => {
  const { sent } = mockSend(t);
  db.exec(`UPDATE reminders SET sent = 1`);
  const n = user();
  createReminder(n, "Remédio", "2026-10-15T23:00:00.000Z"); // 20:00 em Sao Paulo
  await sendDueReminders(new Date(at("2026-10-15T20:00:00-03:00").getTime() + REMINDER_LATE_AFTER_MS));
  assert.deepEqual(textsOf(sent, n), [`🔔 Lembrete: Remédio\n${SNOOZE_HINT}`], "exatamente 10 min ainda e em dia");

  const m = user();
  createReminder(m, "Remédio", "2026-10-15T23:00:00.000Z");
  await sendDueReminders(new Date(at("2026-10-15T20:00:00-03:00").getTime() + REMINDER_LATE_AFTER_MS + 60_000));
  assert.deepEqual(textsOf(sent, m), [`🔔 Lembrete: Remédio\n⏰ (atrasado: era pra qui 15/10 às 20:00)\n${SNOOZE_HINT}`]);
  assert.equal(reminderText("Oi"), `🔔 Lembrete: Oi\n${SNOOZE_HINT}`);
});

test("Card 19: lembrete muito antigo ainda e enviado (sem limite de idade); Evolution fora deixa pra proxima rodada sem perder", async (t) => {
  const { sent, setFail } = mockSend(t);
  db.exec(`UPDATE reminders SET sent = 1`);
  const n = user();
  const id = createReminder(n, "Antigo", "2026-01-05T12:00:00.000Z");
  const silence = console.error;
  console.error = () => {};
  try {
    setFail(true);
    assert.equal(await sendDueReminders(at("2026-10-19T09:00:00-03:00")), 0);
  } finally {
    console.error = silence;
  }
  assert.equal(getReminderById(n, id)?.sent, 0, "continua pendente");
  setFail(false);
  assert.equal(await sendDueReminders(at("2026-10-19T09:01:00-03:00")), 1);
  assert.match(textsOf(sent, n)[0], /⏰ \(atrasado: era pra .*05\/01.*\)/);
  assert.equal(await sendDueReminders(at("2026-10-19T09:02:00-03:00")), 0, "nao reenvia");
});

test("Card 19: lembrete no futuro ou de outro numero nao e afetado", async (t) => {
  const { sent } = mockSend(t);
  db.exec(`UPDATE reminders SET sent = 1`);
  const a = user();
  const b = user();
  createReminder(a, "Amanha", "2026-10-20T12:00:00.000Z");
  createReminder(b, "Do B", "2026-10-19T10:00:00.000Z");
  await sendDueReminders(at("2026-10-19T09:00:00-03:00"));
  assert.deepEqual(textsOf(sent, a), []);
  assert.equal(textsOf(sent, b).length, 1);
});

// ---- eventos -------------------------------------------------------------------------------------------------------------

test("Card 19 (RN09): eventReminderLead -- dentro de 2 min de atraso mantem o texto; depois diz os minutos que faltam", () => {
  const start = "2026-10-15T15:00:00-03:00";
  assert.equal(eventReminderLead(start, 60, at("2026-10-15T14:00:00-03:00")), "1 hora");
  assert.equal(eventReminderLead(start, 60, at("2026-10-15T14:02:00-03:00")), "1 hora", "ate 2 min de atraso e normal");
  assert.equal(eventReminderLead(start, 60, at("2026-10-15T14:40:00-03:00")), "20 min");
  assert.equal(eventReminderLead(start, 60, at("2026-10-15T14:40:30-03:00")), "20 min", "arredonda pra cima");
  assert.equal(eventReminderLead(start, 60, at("2026-10-15T14:59:10-03:00")), "1 min");
  assert.equal(eventReminderLead(start, 1440, at("2026-10-15T09:00:00-03:00")), "6 horas", "aviso de 1 dia que sai atrasado, faltando 6 h");
  assert.equal(eventReminderLead(start, 0, at("2026-10-15T15:00:00-03:00")), "na hora");
  assert.equal(eventReminderLead(start, 30, at("2026-10-15T15:00:00-03:00")), "na hora", "faltando 0 min");
  assert.equal(eventReminderPrefix(start, 30, at("2026-10-15T15:00:00-03:00")), "Agora", "atrasado e comecando: nao diz 'daqui a na hora'");
  assert.equal(eventReminderPrefix(start, 60, at("2026-10-15T14:40:00-03:00")), "Daqui a 20 min");
  assert.equal(eventReminderPrefix(start, 60, at("2026-10-15T14:00:00-03:00")), "Daqui a 1 hora");
});

test("Card 19: evento as 15h com aviso de 1 h e servidor voltando as 14h40 -> 'Daqui a 20 min'; no horario normal -> 'Daqui a 1 hora'", async (t) => {
  const { sent } = mockSend(t);
  const late = user();
  const normal = user();
  createEvent({ fromNumber: late, title: "Dentista", start: "2026-10-15T15:00:00-03:00", reminderMinutes: 60 });
  createEvent({ fromNumber: normal, title: "Reuniao", start: "2026-10-15T15:00:00-03:00", reminderMinutes: 60 });
  db.prepare(`UPDATE events SET reminder_sent = 1 WHERE from_number = ?`).run(normal);
  await sendDueEventReminders(at("2026-10-15T14:40:00-03:00"));
  assert.deepEqual(textsOf(sent, late), ["🔔 Daqui a 20 min: Dentista (15/10, 15:00)"]);

  // no horario: outro evento
  const n2 = user();
  createEvent({ fromNumber: n2, title: "Medico", start: "2026-10-16T15:00:00-03:00", reminderMinutes: 60 });
  await sendDueEventReminders(at("2026-10-16T14:00:30-03:00"));
  assert.deepEqual(textsOf(sent, n2), ["🔔 Daqui a 1 hora: Medico (16/10, 15:00)"]);
});

test("Card 19: aviso extra de evento tambem diz os minutos reais; evento que ja comecou continua ignorado e uma vez so", async (t) => {
  const { sent } = mockSend(t);
  const n = user();
  const event = createEvent({ fromNumber: n, title: "Aula", start: "2026-10-17T18:00:00-03:00", reminderMinutes: 15 });
  addEventExtraReminder(n, event.id, 1440);
  db.prepare(`UPDATE events SET reminder_sent = 1 WHERE id = ?`).run(event.id);
  await sendDueEventReminders(at("2026-10-17T12:00:00-03:00"));
  assert.deepEqual(textsOf(sent, n), ["🔔 Daqui a 6 horas: Aula (17/10, 18:00)"]);
  await sendDueEventReminders(at("2026-10-17T12:01:00-03:00"));
  assert.equal(textsOf(sent, n).length, 1, "nao repete");

  const started = user();
  createEvent({ fromNumber: started, title: "Ja comecou", start: "2026-10-18T10:00:00-03:00", reminderMinutes: 60 });
  await sendDueEventReminders(at("2026-10-18T10:30:00-03:00"));
  assert.deepEqual(textsOf(sent, started), [], "evento que ja comecou nao avisa (D-02)");
});
