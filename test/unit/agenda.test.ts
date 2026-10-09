import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/db";
import {
  parseEndOrDuration,
  resolveEndSpec,
  parseLocationAnswer,
  END_NOT_UNDERSTOOD_TEXT,
  DURATION_RANGE_TEXT,
  MAX_LOCATION_LENGTH,
} from "../../src/confirmation/parsers";
import { computeProposedEnd, eventChangeText, eventChanges, eventHeader, hhmm, leadLabel } from "../../src/events/editPlan";
import {
  computeSnoozeDue,
  formatAlreadyPlayed,
  formatNotPlayedYet,
  formatSnoozeConfirmation,
  snoozeWhenLabel,
  SNOOZE_NEEDS_TIME_TEXT,
  SNOOZE_PAST_TEXT,
  SNOOZE_TOO_FAR_TEXT,
  SNOOZE_TOO_MANY_MINUTES_TEXT,
} from "../../src/reminders/snooze";
import { createEvent, getEventById, updateEvent, markEventReminderSent, addEventExtraReminder, markEventExtraReminderSent } from "../../src/events/service";
import { createReminder, getReminderById, updateReminder, markReminderSent, findRecentSentReminders, rescheduleReminder, getDueReminders } from "../../src/reminders/service";
import { reminderText, SNOOZE_HINT } from "../../src/reminders/scheduler";
import { validateEndAnswer, validateLocationAnswer } from "../../src/fieldMenu/validate";
import { formatCorrectionLabels, correctionQuestion } from "../../src/confirmation/preview";

const START = "2030-10-10T14:00:00-03:00"; // quinta, 14:00 em Sao Paulo

test("resolveEndSpec: horario final em varias formas", () => {
  for (const [text, end] of [
    ["17h", "2030-10-10T17:00:00-03:00"],
    ["17h30", "2030-10-10T17:30:00-03:00"],
    ["17:30", "2030-10-10T17:30:00-03:00"],
    ["às 17", "2030-10-10T17:00:00-03:00"],
    ["até 17h", "2030-10-10T17:00:00-03:00"],
    ["termina 17h", "2030-10-10T17:00:00-03:00"],
    ["termina às 17:15", "2030-10-10T17:15:00-03:00"],
  ] as const) {
    const r = resolveEndSpec(text, START);
    assert.equal(r.ok, true, text);
    if (r.ok) {
      assert.equal(r.end, end, text);
      assert.deepEqual(r.spec, { endTime: end.slice(11, 16) }, text);
    }
  }
});

test("resolveEndSpec: duracao em varias formas e desempate ('2h' e '1h30' viram duracao num evento as 14h)", () => {
  for (const [text, minutes, end] of [
    ["2 horas", 120, "2030-10-10T16:00:00-03:00"],
    ["45 min", 45, "2030-10-10T14:45:00-03:00"],
    ["1 hora e meia", 90, "2030-10-10T15:30:00-03:00"],
    ["meia hora", 30, "2030-10-10T14:30:00-03:00"],
    ["dura 2h", 120, "2030-10-10T16:00:00-03:00"],
    ["dura 2 horas", 120, "2030-10-10T16:00:00-03:00"],
    ["2h", 120, "2030-10-10T16:00:00-03:00"],
    ["1h30", 90, "2030-10-10T15:30:00-03:00"],
    ["1 hora e 15 min", 75, "2030-10-10T15:15:00-03:00"],
  ] as const) {
    const r = resolveEndSpec(text, START);
    assert.equal(r.ok, true, text);
    if (r.ok) {
      assert.deepEqual(r.spec, { durationMinutes: minutes }, text);
      assert.equal(r.end, end, text);
    }
  }
});

test("resolveEndSpec: erros (numero solto, antes do inicio, limites, mesmo dia)", () => {
  assert.deepEqual(resolveEndSpec("2", START), { ok: false, error: END_NOT_UNDERSTOOD_TEXT });
  assert.deepEqual(resolveEndSpec("banana", START), { ok: false, error: END_NOT_UNDERSTOOD_TEXT });
  assert.deepEqual(resolveEndSpec("13:00", START), { ok: false, error: "O término precisa ser depois do início (14:00)." });
  assert.deepEqual(resolveEndSpec("às 14", START), { ok: false, error: "O término precisa ser depois do início (14:00)." });
  assert.deepEqual(resolveEndSpec("3 min", START), { ok: false, error: DURATION_RANGE_TEXT });
  assert.deepEqual(resolveEndSpec("25 horas", START), { ok: false, error: DURATION_RANGE_TEXT });
  assert.deepEqual(resolveEndSpec("25h", START), { ok: false, error: DURATION_RANGE_TEXT });
  assert.deepEqual(resolveEndSpec("12 horas", START), { ok: false, error: "O término precisa ser no mesmo dia do início." });
  // evento de madrugada: "3h" ainda e horario final valido
  assert.equal(resolveEndSpec("3h", "2030-10-10T01:00:00-03:00").ok, true);
  assert.equal(parseEndOrDuration("17h")?.endTime, "17:00");
  assert.equal(parseEndOrDuration("25:00"), null);
});

test("parseLocationAnswer: define, remove (varias frases), recusa vazio e texto longo", () => {
  assert.deepEqual(parseLocationAnswer("  Clínica   Sorriso "), { ok: true, location: "Clínica Sorriso" });
  for (const text of ["remover", "tirar", "tira o local", "sem local", "Remove o local", "remover local", "apagar o local", "nao tem local"]) {
    assert.deepEqual(parseLocationAnswer(text), { ok: true, location: null }, text);
  }
  assert.deepEqual(parseLocationAnswer("   "), { ok: false, error: "Não recebi nada." });
  assert.deepEqual(parseLocationAnswer("x".repeat(MAX_LOCATION_LENGTH)).ok, true);
  assert.deepEqual(parseLocationAnswer("x".repeat(MAX_LOCATION_LENGTH + 1)), { ok: false, error: "Esse texto está muito longo (máximo 100 caracteres)." });
});

test("validadores do menu: termino do evento e local", () => {
  assert.deepEqual(validateEndAnswer("17h", START), { ok: true, value: { endTime: "17:00" } });
  assert.deepEqual(validateEndAnswer("2 horas", START), { ok: true, value: { durationMinutes: 120 } });
  assert.equal(validateEndAnswer("17h", undefined).ok, false);
  assert.equal(validateEndAnswer("2", START).ok, false);
  assert.deepEqual(validateLocationAnswer("remover"), { ok: true, value: { location: null } });
  assert.deepEqual(validateLocationAnswer("Clínica"), { ok: true, value: { location: "Clínica" } });
  assert.equal(validateLocationAnswer("").ok, false);
});

const base = { title: "Consulta", start: START, end: "2030-10-10T15:00:00-03:00", location: "Clínica Sorriso", reminderMinutes: 60 };

test("computeProposedEnd (RN02): horario final, duracao e duracao original preservada", () => {
  assert.deepEqual(computeProposedEnd(base, START, { endTime: "16:30" }), { ok: true, end: "2030-10-10T16:30:00-03:00" });
  assert.deepEqual(computeProposedEnd(base, START, { durationMinutes: 120 }), { ok: true, end: "2030-10-10T16:00:00-03:00" });
  // remarcar sem pedir termino: a duracao original (1h) acompanha o novo inicio
  const moved = computeProposedEnd(base, "2030-10-11T16:00:00-03:00", null);
  assert.equal(moved.ok && new Date(moved.end).getTime(), new Date("2030-10-11T17:00:00-03:00").getTime());
  // horario final no dia do NOVO inicio
  assert.deepEqual(computeProposedEnd(base, "2030-10-11T16:00:00-03:00", { endTime: "18:00" }), { ok: true, end: "2030-10-11T18:00:00-03:00" });
  assert.deepEqual(computeProposedEnd(base, "2030-10-11T16:00:00-03:00", { endTime: "15:00" }), { ok: false, error: "O término precisa ser depois do início (16:00)." });
  assert.deepEqual(computeProposedEnd(base, START, { durationMinutes: 3 }), { ok: false, error: DURATION_RANGE_TEXT });
  assert.deepEqual(computeProposedEnd(base, START, { durationMinutes: 3 * 24 * 60 }), { ok: false, error: DURATION_RANGE_TEXT });
  assert.deepEqual(computeProposedEnd(base, "2030-10-10T23:00:00-03:00", { durationMinutes: 120 }), { ok: false, error: "O término precisa ser no mesmo dia do início." });
});

test("eventHeader e eventChanges: ordem Quando, Termino, Nome, Local, Aviso e so o que muda", () => {
  assert.match(eventHeader(base), /^Consulta — qui 10\/10 às 14:00–15:00 · Clínica Sorriso$/);
  assert.match(eventHeader({ ...base, location: null }), /^Consulta — qui 10\/10 às 14:00–15:00$/);
  assert.equal(hhmm(base.end), "15:00");
  assert.equal(leadLabel(0), "na hora");
  assert.equal(leadLabel(120), "2 horas antes");

  const proposed = { ...base, title: "Dentista", location: null, reminderMinutes: 120, end: "2030-10-10T17:00:00-03:00" };
  const changes = eventChanges(base, proposed, { endTime: "17:00" });
  assert.deepEqual(
    changes.map((c) => [c.key, c.label, c.from, c.to]),
    [
      ["end", "Término", "15:00", "17:00"],
      ["title", "Nome", "Consulta", "Dentista"],
      ["location", "Local", "Clínica Sorriso", "sem local"],
      ["lead", "Aviso", "1 hora antes", "2 horas antes"],
    ]
  );
  assert.equal(eventChangeText(changes), 'término 15:00 → 17:00; título "Consulta" → "Dentista"; local removido; aviso 2 horas antes');

  // remarcar o inicio mantendo a duracao: so "Quando", sem linha de Termino
  const moved = { ...base, start: "2030-10-11T16:00:00-03:00", end: "2030-10-11T17:00:00-03:00" };
  assert.deepEqual(eventChanges(base, moved, null).map((c) => c.key), ["datetime"]);
  // local novo e local trocado
  assert.equal(eventChanges({ ...base, location: null }, { ...base, location: "Casa" }, null)[0].text, 'local "Casa"');
  assert.equal(eventChanges(base, { ...base, location: "Casa" }, null)[0].text, 'local "Clínica Sorriso" → "Casa"');
  assert.equal(eventChanges({ ...base, location: null }, { ...base, location: "Casa" }, null)[0].from, "sem local");
  // pedir o mesmo termino que ja existe nao e mudanca
  assert.deepEqual(eventChanges(base, base, { durationMinutes: 60 }), []);
});

test("rotulos de correcao e novos tipos de pergunta", () => {
  assert.equal(formatCorrectionLabels(["Término", "Local"]), "Qual você quer corrigir?\n1 Término\n2 Local\n\nOu responde *cancelar*.");
  assert.equal(correctionQuestion("endtime"), "Que horas termina ou quanto tempo dura? (ex: 17h30 ou 2 horas) Ou responde *cancelar*.");
  assert.equal(correctionQuestion("location"), "Qual é o local? (ou responde *remover* pra tirar o local) Ou responde *cancelar*.");
});

// ---- adiar lembrete --------------------------------------------------------

const NOW = new Date("2030-10-10T12:00:00-03:00"); // 12:00 em Sao Paulo

test("computeSnoozeDue: minutos, so data, so hora (hoje ou amanha), data e hora, passado e limites", () => {
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { minutes: 30 }, NOW), { ok: true, dueAt: "2030-10-10T12:30:00-03:00" });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { minutes: 90 }, NOW), { ok: true, dueAt: "2030-10-10T13:30:00-03:00" });
  // so a data: mesma hora do lembrete original
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:15:00-03:00", { newDate: "2030-10-11" }, NOW), { ok: true, dueAt: "2030-10-11T08:15:00-03:00" });
  // so a hora: hoje se ainda for futura, senao amanha
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newTime: "15:00" }, NOW), { ok: true, dueAt: "2030-10-10T15:00:00-03:00" });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newTime: "09:00" }, NOW), { ok: true, dueAt: "2030-10-11T09:00:00-03:00" });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newTime: "12:00" }, NOW), { ok: true, dueAt: "2030-10-11T12:00:00-03:00" }); // nao ha 1 minuto de folga
  // data e hora exatas (data com hora junto e aceita: so o dia vale)
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newDate: "2030-10-11T00:00:00", newTime: "09:00" }, NOW), { ok: true, dueAt: "2030-10-11T09:00:00-03:00" });
  // data/hora vencem os minutos
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { minutes: 5, newTime: "15:00" }, NOW), { ok: true, dueAt: "2030-10-10T15:00:00-03:00" });

  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { minutes: 0 }, NOW), { ok: false, error: SNOOZE_PAST_TEXT });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newDate: "2030-10-09", newTime: "09:00" }, NOW), { ok: false, error: SNOOZE_PAST_TEXT });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { newDate: "2031-11-01", newTime: "09:00" }, NOW), { ok: false, error: SNOOZE_TOO_FAR_TEXT });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", { minutes: 50000 }, NOW), { ok: false, error: SNOOZE_TOO_MANY_MINUTES_TEXT });
  assert.deepEqual(computeSnoozeDue("2030-10-10T08:00:00-03:00", {}, NOW), { ok: false, error: SNOOZE_NEEDS_TIME_TEXT });
});

test("mensagens do adiar: confirmacao, 'ainda nao tocou' e 'ja tocou'", () => {
  assert.equal(snoozeWhenLabel("2030-10-10T12:30:00-03:00", NOW), "às 12:30");
  assert.equal(snoozeWhenLabel("2030-10-11T09:00:00-03:00", NOW), "amanhã às 09:00");
  assert.match(snoozeWhenLabel("2030-10-15T09:00:00-03:00", NOW), /^ter 15\/10 às 09:00$/);
  assert.equal(
    formatSnoozeConfirmation("Remédio", "2030-10-10T12:30:00-03:00", 30, NOW),
    '⏰ Adiado! Te lembro de "Remédio" de novo às 12:30 (daqui a 30 min). Errou? Responde *desfazer*.'
  );
  assert.equal(
    formatSnoozeConfirmation("Remédio", "2030-10-11T09:00:00-03:00", undefined, NOW),
    '⏰ Adiado! Te lembro de "Remédio" de novo amanhã às 09:00. Errou? Responde *desfazer*.'
  );
  assert.equal(
    formatNotPlayedYet("Remédio", "2030-10-11T08:00:00-03:00", "remédio", NOW),
    '"Remédio" ainda não tocou (é amanhã às 08:00). Pra mudar o horário, diga "muda o lembrete do remédio pra …".'
  );
  assert.match(formatNotPlayedYet("Remédio", "2030-10-10T18:00:00-03:00", "remédio", NOW), /\(é hoje às 18:00\)/);
  assert.match(formatNotPlayedYet("Remédio", "2030-10-20T18:00:00-03:00", "remédio", NOW), /\(é dom 20\/10 às 18:00\)/);
  assert.match(formatAlreadyPlayed("Remédio", "2030-10-10T08:00:00-03:00"), /^O lembrete "Remédio" já tocou \(qui 10\/10 às 08:00\)\. Pra tocar de novo, diga "adia o remédio pra amanhã 9h"\.$/);
});

test("mensagem do lembrete que toca traz a dica de adiar (RN16)", () => {
  assert.equal(reminderText("Remédio"), `🔔 Lembrete: Remédio\n${SNOOZE_HINT}`);
  assert.equal(SNOOZE_HINT, 'Pra adiar, responde "adia 30 min" ou "adia pra amanhã 9h".');
});

// ---- servico: RN10 (nao reenviar aviso) -------------------------------------

function extraSent(eventId: number): number[] {
  return (db.prepare(`SELECT sent FROM event_extra_reminders WHERE event_id = ?`).all(eventId) as { sent: number }[]).map((r) => r.sent);
}

test("RN10 evento: titulo, local ou termino sozinhos NAO reativam o aviso ja enviado; inicio e antecedencia reativam", () => {
  const N = "551100160001";
  const ev = createEvent({ fromNumber: N, title: "Consulta rn10", start: START, end: "2030-10-10T15:00:00-03:00", location: "A", reminderMinutes: 60 });
  addEventExtraReminder(N, ev.id, 1440);
  const resend = () => {
    markEventReminderSent(N, ev.id);
    db.prepare(`UPDATE event_extra_reminders SET sent = 1 WHERE event_id = ?`).run(ev.id);
  };
  const params = (over: Partial<{ title: string; start: string; end: string; location: string; reminderMinutes: number }> = {}) => ({
    title: "Consulta rn10",
    start: START,
    end: "2030-10-10T15:00:00-03:00",
    location: "A",
    reminderMinutes: 60,
    ...over,
  });

  resend();
  updateEvent(N, ev.id, params({ title: "Outro titulo" }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 1);
  assert.deepEqual(extraSent(ev.id), [1]);

  updateEvent(N, ev.id, params({ title: "Outro titulo", location: "B" }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 1);
  updateEvent(N, ev.id, params({ title: "Outro titulo", location: "B", end: "2030-10-10T17:00:00-03:00" }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 1);
  assert.deepEqual(extraSent(ev.id), [1]);
  // o mesmo instante escrito de outro jeito (UTC) tambem nao conta como mudanca de inicio
  updateEvent(N, ev.id, params({ title: "Outro titulo", location: "B", start: new Date(START).toISOString() }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 1);

  // antecedencia mudou: reativa o principal, mas os extras continuam como estavam
  updateEvent(N, ev.id, params({ title: "Outro titulo", location: "B", reminderMinutes: 120 }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 0);
  assert.deepEqual(extraSent(ev.id), [1]);

  // inicio mudou: reativa o principal E os extras
  resend();
  updateEvent(N, ev.id, params({ title: "Outro titulo", location: "B", reminderMinutes: 120, start: "2030-10-11T14:00:00-03:00", end: "2030-10-11T15:00:00-03:00" }));
  assert.equal(getEventById(N, ev.id)?.reminder_sent, 0);
  assert.deepEqual(extraSent(ev.id), [0]);

  // evento de outro numero / inexistente: nao faz nada
  updateEvent("551100160099", ev.id, params({ title: "invasor" }));
  assert.equal(getEventById(N, ev.id)?.title, "Outro titulo");
  markEventExtraReminderSent(0);
});

test("RN10 lembrete: texto sozinho NAO reativa um lembrete que ja tocou; mudar o horario reativa", () => {
  const N = "551100160002";
  const id = createReminder(N, "Remédio rn10", "2030-10-10T08:00:00-03:00");
  markReminderSent(N, id);

  updateReminder(N, id, { message: "Remédio novo", dueAt: "2030-10-10T08:00:00-03:00" });
  assert.equal(getReminderById(N, id)?.sent, 1);
  assert.equal(getReminderById(N, id)?.message, "Remédio novo");
  // mesmo instante em outro formato tambem nao conta
  updateReminder(N, id, { message: "Remédio novo", dueAt: new Date("2030-10-10T08:00:00-03:00").toISOString() });
  assert.equal(getReminderById(N, id)?.sent, 1);

  updateReminder(N, id, { message: "Remédio novo", dueAt: "2030-10-11T09:00:00-03:00" });
  assert.equal(getReminderById(N, id)?.sent, 0);

  // lembrete pendente editado so no texto continua pendente
  updateReminder(N, id, { message: "Outro texto", dueAt: "2030-10-11T09:00:00-03:00" });
  assert.equal(getReminderById(N, id)?.sent, 0);
  updateReminder("551100160098", id, { message: "invasor", dueAt: "2030-10-11T09:00:00-03:00" });
  assert.equal(getReminderById(N, id)?.message, "Outro texto");
});

test("findRecentSentReminders: janela de 2h sem texto, 24h com texto, so enviados, so desse numero", () => {
  const N = "551100160003";
  const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const recent = createReminder(N, "Remédio recente", iso(0.1));
  const mid = createReminder(N, "Remédio de ontem", iso(5));
  const old = createReminder(N, "Remédio antigo", iso(30));
  const pending = createReminder(N, "Remédio pendente", new Date(Date.now() + 3600 * 1000).toISOString());
  const other = createReminder("551100160004", "Remédio alheio", iso(0.1));
  for (const [n, id] of [[N, recent], [N, mid], [N, old], ["551100160004", other]] as const) markReminderSent(n, id);

  assert.deepEqual(findRecentSentReminders(N, undefined, 2).map((r) => r.id), [recent]);
  assert.deepEqual(findRecentSentReminders(N, "remédio", 24).map((r) => r.id), [recent, mid]);
  assert.deepEqual(findRecentSentReminders(N, "antigo", 24), []);
  assert.deepEqual(findRecentSentReminders(N, "antigo", 48).map((r) => r.id), [old]);
  assert.deepEqual(findRecentSentReminders(N, "remédio", 24, 1).map((r) => r.id), [recent]);
  assert.ok(!findRecentSentReminders(N, undefined, 100).some((r) => r.id === pending));
});

test("rescheduleReminder grava horario e estado exatos (adiar volta a pendente; desfazer volta a enviado sem tocar)", () => {
  const N = "551100160005";
  const id = createReminder(N, "Remédio snooze", "2000-01-01T08:00:00-03:00");
  markReminderSent(N, id);
  rescheduleReminder(N, id, "2030-10-10T12:30:00-03:00", 0);
  assert.equal(getReminderById(N, id)?.sent, 0);
  assert.equal(getReminderById(N, id)?.due_at, "2030-10-10T12:30:00-03:00");
  rescheduleReminder(N, id, "2000-01-01T08:00:00-03:00", 1);
  assert.equal(getReminderById(N, id)?.sent, 1);
  assert.ok(!getDueReminders().some((r) => r.id === id)); // nao toca de novo
  rescheduleReminder("551100160099", id, "2031-01-01T08:00:00-03:00", 0); // outro numero: nada
  assert.equal(getReminderById(N, id)?.sent, 1);
});
