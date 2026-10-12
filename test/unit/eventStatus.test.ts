import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EVENT_MINUTES, eventEndMs, eventStatusSuffix, eventTiming } from "../../src/events/status";
import { eventLine } from "../../src/targetChoice/format";
import { eventHeader } from "../../src/events/editPlan";
import { formatEditPreview, formatWhen, PREVIEW_OPTIONS } from "../../src/confirmation/preview";

// evento das 14:00 as 15:00 (-03:00)
const EVENT = { start: "2026-10-14T14:00:00-03:00", end: "2026-10-14T15:00:00-03:00" };
const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00-03:00`);

test("eventTiming: futuro, em andamento e terminado (limites: comecou = em andamento, terminou = terminado)", () => {
  assert.equal(eventTiming(EVENT, at("13:59")), "upcoming");
  assert.equal(eventTiming(EVENT, at("14:00")), "ongoing");
  assert.equal(eventTiming(EVENT, at("14:59")), "ongoing");
  assert.equal(eventTiming(EVENT, at("15:00")), "ended");
  assert.equal(eventTiming(EVENT, at("18:00")), "ended");
});

test("eventEndMs: sem termino (ausente, null, vazio ou invalido) assume a duracao padrao de 1 h", () => {
  const startMs = new Date(EVENT.start).getTime();
  assert.equal(DEFAULT_EVENT_MINUTES, 60);
  for (const end of [undefined, null, "", "lixo"]) {
    assert.equal(eventEndMs({ start: EVENT.start, end }), startMs + 60 * 60 * 1000, String(end));
  }
  assert.equal(eventEndMs(EVENT), new Date(EVENT.end).getTime());
  // sem termino gravado, "em andamento" vale pela hora padrao
  assert.equal(eventTiming({ start: EVENT.start }, at("14:30")), "ongoing");
  assert.equal(eventTiming({ start: EVENT.start, end: null }, at("15:30")), "ended");
});

test("eventStatusSuffix: vazio no futuro, ' · em andamento' e ' · terminou há pouco'", () => {
  assert.equal(eventStatusSuffix(EVENT, at("10:00")), "");
  assert.equal(eventStatusSuffix(EVENT, at("14:30")), " · em andamento");
  assert.equal(eventStatusSuffix(EVENT, at("16:00")), " · terminou há pouco");
});

test("eventStatusSuffix: sem 'agora' injetado usa Date.now (relogio mockavel)", (t) => {
  t.mock.method(Date, "now", () => at("14:30").getTime());
  assert.equal(eventStatusSuffix(EVENT), " · em andamento");
  assert.equal(eventTiming(EVENT), "ongoing");
});

test("eventLine: titulo + quando + situacao (so a linha de evento em andamento/terminado ganha sufixo)", () => {
  const when = formatWhen(EVENT.start);
  assert.equal(eventLine({ title: "Reunião", ...EVENT }, at("10:00")), `Reunião — ${when}`);
  assert.equal(eventLine({ title: "Reunião", ...EVENT }, at("14:30")), `Reunião — ${when} · em andamento`);
  assert.equal(eventLine({ title: "Reunião", ...EVENT }, at("16:00")), `Reunião — ${when} · terminou há pouco`);
  // evento sem termino gravado (opcional na linha)
  assert.equal(eventLine({ title: "Reunião", start: EVENT.start }, at("14:30")), `Reunião — ${when} · em andamento`);
});

test("eventHeader: sufixo de situacao vem depois do local", () => {
  const when = formatWhen(EVENT.start);
  const base = { title: "Consulta", ...EVENT, location: "Clínica Sorriso" };
  assert.equal(eventHeader(base, at("10:00")), `Consulta — ${when}–15:00 · Clínica Sorriso`);
  assert.equal(eventHeader(base, at("14:30")), `Consulta — ${when}–15:00 · Clínica Sorriso · em andamento`);
  assert.equal(eventHeader({ ...base, location: null }, at("14:30")), `Consulta — ${when}–15:00 · em andamento`);
});

test("formatEditPreview: aviso opcional entra antes das opcoes; sem aviso a previa nao muda", () => {
  const changes = [{ label: "Dia e hora", from: "ter 13/10 às 14:00", to: "seg 12/10 às 14:00" }];
  assert.equal(formatEditPreview("Consulta", changes), `✏️ Consulta\nDia e hora: ter 13/10 às 14:00 → seg 12/10 às 14:00\n\n${PREVIEW_OPTIONS}`);
  assert.equal(
    formatEditPreview("Consulta", changes, "⚠️ Aviso."),
    `✏️ Consulta\nDia e hora: ter 13/10 às 14:00 → seg 12/10 às 14:00\n⚠️ Aviso.\n\n${PREVIEW_OPTIONS}`
  );
});
