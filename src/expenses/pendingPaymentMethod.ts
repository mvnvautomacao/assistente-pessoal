// Fila curta em memoria: guarda gastos (ja com categoria resolvida) que so
// falta saber a forma de pagamento antes de registrar -- acontece quando o
// usuario nao mencionou a forma na mensagem, nao tem uma padrao definida, e tem
// 0 ou 2+ formas cadastradas (com exatamente 1, o sistema usa ela sozinho, sem
// perguntar -- ver autoResolvePaymentMethod em router.ts). E uma FILA (nao um
// unico slot) pela mesma razao de pendingCompletion.ts: um lote com 2+ gastos
// ambiguos ao mesmo tempo (ver tryCreateExpenseBatch, que desiste do lote
// inteiro nesse caso) processa cada gasto em sequencia na mesma mensagem --
// um slot unico faria o segundo sobrescrever o primeiro antes de ele ser
// respondido, perdendo o gasto silenciosamente.
const TTL_MS = 5 * 60 * 1000;

export interface PendingExpensePaymentMethod {
  amount: number;
  description: string;
  date: string;
  categoryId: number;
  categoryName: string;
  createdAt: number;
}

const queues = new Map<string, PendingExpensePaymentMethod[]>();

function pruneExpired(fromNumber: string) {
  const queue = queues.get(fromNumber);
  if (!queue) return;
  while (queue.length && Date.now() - queue[0].createdAt > TTL_MS) queue.shift();
}

// Adiciona no fim da fila. Retorna true se virou o item da vez (fila estava
// vazia antes), pra quem chamou saber se deve perguntar agora ou so guardar
// pra perguntar depois que o(s) anterior(es) forem resolvidos.
export function addPendingExpensePaymentMethod(fromNumber: string, data: Omit<PendingExpensePaymentMethod, "createdAt">): boolean {
  pruneExpired(fromNumber);
  const queue = queues.get(fromNumber) ?? [];
  const wasEmpty = queue.length === 0;
  queue.push({ ...data, createdAt: Date.now() });
  queues.set(fromNumber, queue);
  return wasEmpty;
}

export function getNextPendingExpensePaymentMethod(fromNumber: string): PendingExpensePaymentMethod | null {
  pruneExpired(fromNumber);
  const queue = queues.get(fromNumber);
  return queue?.[0] ?? null;
}

// Remove o item da vez (resolvido). O proximo da fila, se houver, vira
// automaticamente o novo item da vez.
export function clearHeadPendingExpensePaymentMethod(fromNumber: string): PendingExpensePaymentMethod | null {
  const queue = queues.get(fromNumber);
  if (!queue || queue.length === 0) return null;
  return queue.shift() ?? null;
}

// So pra teste: forca o item da vez a parecer mais antigo do que e, sem
// precisar esperar o timeout de verdade passar (ver PENDING_PAYMENT_METHOD_TTL_MS
// em router.ts).
export function backdatePendingExpensePaymentMethodForTests(fromNumber: string, ageMs: number) {
  const queue = queues.get(fromNumber);
  if (!queue || queue.length === 0) return;
  queue[0].createdAt = Date.now() - ageMs;
}
