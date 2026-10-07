import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPRINT_LENGTH_DAYS,
  ensureActiveSprint,
  getActiveSprint,
  addCard,
  moveCard,
  updateCard,
  deleteCard,
  listCards,
  getCardById,
  setSprintEndDate,
  closeActiveSprintAndStartNext,
  daysLeft,
  listSprints,
} from "../../src/sprints/service";
import { spDateString, addDaysToDateString } from "../../src/timeSP";

// O sprint ativo e GLOBAL (um so por vez) e compartilhado por todos os testes
// desse arquivo -- por isso o primeiro teste cria e os seguintes encadeiam.
test("sem sprint ativo, ensureActiveSprint cria um de 10 dias a partir de hoje; chamar de novo devolve o mesmo", () => {
  assert.equal(getActiveSprint(), null);
  const sprint = ensureActiveSprint();
  assert.equal(sprint.status, "active");
  assert.equal(sprint.start_date, spDateString());
  assert.equal(sprint.end_date, addDaysToDateString(spDateString(), SPRINT_LENGTH_DAYS));
  assert.equal(ensureActiveSprint().id, sprint.id);
  assert.equal(daysLeft(sprint), SPRINT_LENGTH_DAYS);
});

test("card entra no backlog do sprint ativo por padrao, anda pelas colunas e marca done_at so em feito", () => {
  const card = addCard({ title: "  Kanban de sprints  ", type: "evolucao" })!;
  assert.equal(card.title, "Kanban de sprints"); // trim
  assert.equal(card.status, "backlog");
  assert.equal(card.type, "evolucao");
  assert.equal(card.sprint_id, ensureActiveSprint().id);
  assert.equal(card.done_at, null);

  for (const status of ["refinado", "a_fazer", "fazendo", "testando"] as const) {
    assert.ok(moveCard(card.id, status));
    assert.equal(getCardById(card.id)!.status, status);
    assert.equal(getCardById(card.id)!.done_at, null);
  }
  assert.ok(moveCard(card.id, "feito"));
  assert.ok(getCardById(card.id)!.done_at);
  moveCard(card.id, "testando"); // voltar tira o done_at
  assert.equal(getCardById(card.id)!.done_at, null);
  assert.equal(moveCard(999999, "feito"), false);
});

test("addCard rejeita titulo vazio, e card ja criado como 'feito' ja vem com done_at", () => {
  assert.equal(addCard({ title: "   " }), null);
  const done = addCard({ title: "Ja entregue", status: "feito", type: "incidente" })!;
  assert.ok(done.done_at);
  assert.equal(done.type, "incidente");
});

test("updateCard muda so o que foi passado, e deleteCard apaga", () => {
  const card = addCard({ title: "Original", description: "detalhe" })!;
  updateCard(card.id, { title: "Novo titulo" });
  const updated = getCardById(card.id)!;
  assert.equal(updated.title, "Novo titulo");
  assert.equal(updated.description, "detalhe");
  updateCard(card.id, { description: "" }); // limpar descricao
  assert.equal(getCardById(card.id)!.description, null);
  assert.ok(deleteCard(card.id));
  assert.equal(getCardById(card.id), null);
});

test("setSprintEndDate ajusta o prazo, mas rejeita formato invalido e fim antes do inicio", () => {
  const sprint = ensureActiveSprint();
  const newEnd = addDaysToDateString(sprint.start_date, 14);
  assert.ok(setSprintEndDate(sprint.id, newEnd));
  assert.equal(ensureActiveSprint().end_date, newEnd);

  assert.equal(setSprintEndDate(sprint.id, "31/12/2026"), false);
  assert.equal(setSprintEndDate(sprint.id, addDaysToDateString(sprint.start_date, -1)), false);
  assert.equal(ensureActiveSprint().end_date, newEnd); // nao mudou
});

test("encerrar sprint abre o proximo: o que nao esta feito passa pra frente (mantendo a coluna), feito fica no sprint encerrado", () => {
  const old = ensureActiveSprint();
  const pending = addCard({ title: "Ainda fazendo", status: "fazendo" })!;
  const finished = addCard({ title: "Ja feito no sprint", status: "feito" })!;

  const { closed, next } = closeActiveSprintAndStartNext();
  assert.equal(closed!.id, old.id);
  assert.notEqual(next.id, old.id);
  assert.equal(getActiveSprint()!.id, next.id);
  assert.equal(next.end_date, addDaysToDateString(spDateString(), SPRINT_LENGTH_DAYS));

  assert.equal(getCardById(pending.id)!.sprint_id, next.id);
  assert.equal(getCardById(pending.id)!.status, "fazendo");
  assert.equal(getCardById(finished.id)!.sprint_id, old.id);
  assert.ok(listCards(old.id).some((c) => c.id === finished.id));
  assert.equal(listSprints().filter((s) => s.status === "active").length, 1); // sempre um so ativo
});

test("daysLeft: positivo antes do fim, zero no dia, negativo depois (atrasado)", () => {
  const sprint = { id: 1, name: "x", start_date: "2026-10-01", end_date: "2026-10-11", status: "active" as const, created_at: "" };
  assert.equal(daysLeft(sprint, "2026-10-06"), 5);
  assert.equal(daysLeft(sprint, "2026-10-11"), 0);
  assert.equal(daysLeft(sprint, "2026-10-13"), -2);
});
