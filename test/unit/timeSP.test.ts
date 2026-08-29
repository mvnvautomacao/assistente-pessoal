import { test } from "node:test";
import assert from "node:assert/strict";
import { spDateString, spDayOfWeek, isLastDayOfMonthSP, ensureBrazilOffset } from "../../src/timeSP";

test("spDateString formata no fuso de Sao Paulo, nao no fuso do processo", () => {
  // meio-dia UTC e sempre 09:00 em SP (UTC-3, sem horario de verao) -> mesmo dia calendario
  const d = new Date("2026-03-15T12:00:00Z");
  assert.equal(spDateString(d), "2026-03-15");
});

test("spDateString: perto da meia-noite UTC, o dia em SP ainda e o anterior", () => {
  // 02:00 UTC de 16/03 = 23:00 de 15/03 em SP (UTC-3)
  const d = new Date("2026-03-16T02:00:00Z");
  assert.equal(spDateString(d), "2026-03-15");
});

test("spDayOfWeek bate com Date.getDay() pra uma data em UTC-3 sem ambiguidade", () => {
  // 15/03/2026 e um domingo
  const d = new Date("2026-03-15T15:00:00Z"); // 12:00 em SP, mesmo dia
  assert.equal(spDayOfWeek(d), 0);
});

test("isLastDayOfMonthSP: 31/01 e o ultimo dia", () => {
  const d = new Date("2026-01-31T15:00:00Z");
  assert.equal(isLastDayOfMonthSP(d), true);
});

test("isLastDayOfMonthSP: 30/01 nao e o ultimo dia", () => {
  const d = new Date("2026-01-30T15:00:00Z");
  assert.equal(isLastDayOfMonthSP(d), false);
});

test("isLastDayOfMonthSP: fevereiro em ano bissexto (2028) termina dia 29", () => {
  assert.equal(isLastDayOfMonthSP(new Date("2028-02-29T15:00:00Z")), true);
  assert.equal(isLastDayOfMonthSP(new Date("2028-02-28T15:00:00Z")), false);
});

// Regressao: a IA as vezes devolve o horario do evento/lembrete sem o offset
// -03:00 explicito. Sem isso, new Date(str) e o datetime() do SQLite tratam a
// string como se ja fosse UTC -- funciona por acaso num dev configurado em
// America/Sao_Paulo, mas em producao (container roda em UTC) isso ADIANTA o
// evento em 3h (ex: "15h" vira "12h" na tela, foi reportado em producao).
test("ensureBrazilOffset acrescenta -03:00 quando a string nao tem offset explicito", () => {
  const withOffset = ensureBrazilOffset("2026-08-27T15:00:00");
  assert.equal(withOffset, "2026-08-27T15:00:00-03:00");
  // 15h em Brasilia (UTC-3) tem que virar 18h UTC, nao importa o fuso do processo
  // que roda esse teste -- toISOString() sempre normaliza pra UTC.
  assert.equal(new Date(withOffset).toISOString(), "2026-08-27T18:00:00.000Z");
});

test("ensureBrazilOffset funciona tambem sem os segundos", () => {
  const withOffset = ensureBrazilOffset("2026-08-27T15:00");
  assert.equal(withOffset, "2026-08-27T15:00-03:00");
  assert.equal(new Date(withOffset).toISOString(), "2026-08-27T18:00:00.000Z");
});

test("ensureBrazilOffset nao mexe se a string ja tiver offset ou for UTC (Z)", () => {
  assert.equal(ensureBrazilOffset("2026-08-27T15:00:00-03:00"), "2026-08-27T15:00:00-03:00");
  assert.equal(ensureBrazilOffset("2026-08-27T18:00:00Z"), "2026-08-27T18:00:00Z");
  assert.equal(ensureBrazilOffset("2026-08-27T15:00:00+00:00"), "2026-08-27T15:00:00+00:00");
});

// Regressao: se a mensagem do usuario nao tiver hora nenhuma (so "adicionar
// consulta medica", sem "quando"), a IA pode devolver so a data. Sem esse caso
// especial, "2026-09-10-03:00" e um ISO invalido -- vira Invalid Date, quebra
// o calculo do "end" do evento (new Date(invalido).toISOString() lanca excecao).
test("ensureBrazilOffset assume meia-noite quando a string e so uma data, sem hora", () => {
  const withOffset = ensureBrazilOffset("2026-09-10");
  assert.equal(withOffset, "2026-09-10T00:00:00-03:00");
  assert.doesNotThrow(() => new Date(withOffset).toISOString());
});
