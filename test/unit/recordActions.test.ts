// Card 21 (RN02): o conjunto de pedidos que mexem em registro e completo -- um tipo novo de editar/apagar/remover nao fica de fora da
// regra "uma confirmacao por vez" sem alguem decidir isso aqui, por escrito.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERPRETATION_TYPES } from "../../src/ai/interpret";
import { isDeletionAction, isRecordAction, RECORD_ACTION_EXTRA_NAMES, RECORD_ACTION_PREFIXES, RECORD_ACTION_TYPES } from "../../src/confirmation/recordActions";

// tipos com esses prefixos que, de proposito, NAO precisam estar no conjunto (cada um justificado). Hoje nenhum.
const EXCEPTIONS: Record<string, string> = {};

test("todo tipo com prefixo edit_/delete_/remove_/add_/rename_ (ou merge/bulk/correct) esta no conjunto ou numa excecao justificada", () => {
  const needing = INTERPRETATION_TYPES.filter(
    (type) => RECORD_ACTION_PREFIXES.some((prefix) => type.startsWith(prefix)) || (RECORD_ACTION_EXTRA_NAMES as readonly string[]).includes(type)
  );
  assert.ok(needing.length >= 20, `a lista de tipos veio incompleta: ${needing.join(", ")}`);
  const missing = needing.filter((type) => !isRecordAction(type) && !(type in EXCEPTIONS));
  assert.deepEqual(missing, [], `tipos que mexem em registro fora do conjunto (e sem excecao): ${missing.join(", ")}`);
  for (const [type, why] of Object.entries(EXCEPTIONS)) assert.ok(why.length > 10, `excecao ${type} sem justificativa`);
});

test("todo tipo do conjunto existe de verdade em Interpretation (nada de nome velho ou digitado errado)", () => {
  const known = new Set(INTERPRETATION_TYPES);
  const unknown = RECORD_ACTION_TYPES.filter((type) => !known.has(type));
  assert.deepEqual(unknown, []);
  assert.equal(new Set(RECORD_ACTION_TYPES).size, RECORD_ACTION_TYPES.length, "sem repetidos");
});

test("consultas e criacoes diretas nao entram; exclusao x alteracao", () => {
  for (const type of ["expense", "event", "reminder", "report", "list_reminders", "list_expenses", "undo", "help", "unknown", "income", "create_category", "snooze_reminder", "set_budget"]) {
    assert.equal(isRecordAction(type), false, type);
  }
  for (const type of ["delete_event", "delete_expense", "remove_budget", "remove_bill_alert", "delete_category", "delete_income", "remove_event_reminder"]) {
    assert.equal(isDeletionAction(type), true, type);
    assert.equal(isRecordAction(type), true, type);
  }
  for (const type of ["edit_event", "rename_category", "merge_categories", "bulk_recategorize", "correct_category", "add_event_reminder"]) {
    assert.equal(isDeletionAction(type), false, type);
    assert.equal(isRecordAction(type), true, type);
  }
});
