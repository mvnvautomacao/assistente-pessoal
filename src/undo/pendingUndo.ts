// Cache curto e em memoria: guarda a ultima acao reversivel de cada numero (so
// dados, sem logica de execucao — quem desfaz de verdade e o router.ts, que ja
// importa as funcoes de delete/update de cada dominio). Mesma ideia dos outros
// caches de conversa (listCache.ts, pendingListChoice.ts, pendingDeletion.ts).
const TTL_MS = 10 * 60 * 1000;

export type UndoAction =
  | { kind: "delete_expense"; expenseId: number; description: string }
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
  | { kind: "delete_income"; incomeId: number; description: string };

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
