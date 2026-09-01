// Cache curto e em memoria: guarda a ultima acao reversivel de cada numero (so
// dados, sem logica de execucao — quem desfaz de verdade e o router.ts, que ja
// importa as funcoes de delete/update de cada dominio). Mesma ideia dos outros
// caches de conversa (listCache.ts, pendingListChoice.ts, pendingDeletion.ts).
const TTL_MS = 10 * 60 * 1000;

export type UndoAction =
  | { kind: "delete_expense"; expenseId: number; description: string }
  | { kind: "delete_expenses_bulk"; expenseIds: number[]; description: string }
  | {
      kind: "restore_expense";
      expenseId: number;
      previous: { amount: number; description: string; date: string; categoryId: number | null; paymentMethodId: number | null };
      description: string;
    }
  | { kind: "restore_category"; expenseId: number; previousCategoryId: number; description: string }
  | { kind: "delete_event"; eventId: number; description: string }
  | {
      kind: "recreate_event";
      params: { fromNumber: string; title: string; start: string; end?: string; location?: string; reminderMinutes?: number };
      description: string;
    }
  | { kind: "delete_reminder"; reminderId: number; description: string }
  | { kind: "delete_income"; incomeId: number; description: string }
  | {
      kind: "bulk_restore_category";
      changes: { expenseId: number; previousCategoryId: number | null }[];
      description: string;
    }
  | {
      // merge apaga a categoria de origem, entao desfazer nao pode voltar pro
      // MESMO id (nao existe mais) -- recria a categoria pelo nome e move os
      // gastos de volta pra ela.
      kind: "undo_merge_categories";
      expenseIds: number[];
      sourceCategoryName: string;
      description: string;
    }
  | {
      kind: "restore_event_time";
      eventId: number;
      previous: { title: string; start: string; end: string; location: string | null; reminderMinutes: number };
      description: string;
    }
  | { kind: "restore_reminder_time"; reminderId: number; previousDueAt: string; description: string }
  | { kind: "restore_budget"; categoryId: number; monthlyLimit: number; description: string }
  | {
      // desativar um gasto fixo nao apaga o registro (so muda active=0), mas
      // recriar do zero (em vez de reativar por id) mantem o mesmo padrao dos
      // outros undos desse arquivo, que nao dependem de saber implementacao interna
      kind: "restore_recurring_expense";
      params: {
        fromNumber: string;
        description: string;
        amount: number;
        categoryId: number | null;
        paymentMethodId: number | null;
        dayOfMonth: number;
      };
      description: string;
    };

interface PendingUndo {
  action: UndoAction;
  createdAt: number;
}

const pending = new Map<string, PendingUndo>();

export function setPendingUndo(fromNumber: string, action: UndoAction) {
  pending.set(fromNumber, { action, createdAt: Date.now() });
}

export function getPendingUndo(fromNumber: string): UndoAction | null {
  const entry = pending.get(fromNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(fromNumber);
    return null;
  }
  return entry.action;
}

export function clearPendingUndo(fromNumber: string) {
  pending.delete(fromNumber);
}
