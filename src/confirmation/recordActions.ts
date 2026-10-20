// Tipos de pedido que MEXEM em registro (editar, apagar, remover, juntar, recategorizar em lote, aviso de evento...). Numa mesma
// mensagem so o PRIMEIRO deles gera pergunta; os outros sao adiados (RN10 do Card 3, estendido pelo Card 21 / D-01: antes so as
// edicoes entravam e uma exclusao junto de uma edicao deixava DUAS perguntas abertas, "1" podia cair na errada).
// A lista e explicita e unica; o teste de tabela (test/unit/recordActions.test.ts) falha se aparecer um tipo novo com prefixo
// edit_/delete_/remove_/add_/rename_ (ou merge/bulk/correct) fora dela.

export const RECORD_ACTION_TYPES: readonly string[] = [
  // editar
  "edit_event",
  "edit_reminder",
  "edit_expense",
  "edit_income",
  "edit_recurring_expense",
  "edit_bill_alert",
  "correct_category",
  "rename_category",
  "rename_payment_method",
  "merge_categories",
  "bulk_recategorize",
  // apagar / remover
  "delete_event",
  "delete_reminder",
  "delete_expense",
  "delete_income",
  "delete_category",
  "remove_budget",
  "remove_recurring_expense",
  "remove_bill_alert",
  // avisos de evento
  "add_event_reminder",
  "remove_event_reminder",
];

const RECORD_ACTION_SET: ReadonlySet<string> = new Set(RECORD_ACTION_TYPES);

export function isRecordAction(type: string): boolean {
  return RECORD_ACTION_SET.has(type);
}

// "exclusao" (delete_/remove_) ou "alteracao" (o resto) -- so muda a palavra do aviso de adiamento (RN04)
export function isDeletionAction(type: string): boolean {
  return type.startsWith("delete_") || type.startsWith("remove_");
}

// prefixos que obrigam o tipo a estar na lista (usado pelo teste de tabela)
export const RECORD_ACTION_PREFIXES = ["edit_", "delete_", "remove_", "add_", "rename_"] as const;
export const RECORD_ACTION_EXTRA_NAMES = ["merge_categories", "bulk_recategorize", "correct_category"] as const;
