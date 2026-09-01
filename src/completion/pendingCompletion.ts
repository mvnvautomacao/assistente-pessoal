// Fila curta em memoria: guarda pedidos de evento/lembrete/gasto que vieram
// incompletos (ex: "quarta feira agendar revisao do carro", sem hora), pra
// perguntar so o que falta em vez de inventar ou pedir a mensagem toda de novo.
// E uma FILA (nao um unico slot) porque uma mensagem so pode trazer mais de um
// pedido incompleto ao mesmo tempo (ex: dois compromissos sem hora no mesmo
// audio) -- resolve um de cada vez, na ordem em que apareceram.
const TTL_MS = 5 * 60 * 1000;

export type PendingCompletionIntent =
  | { intent: "event"; title?: string; date?: string; time?: string; missing: Array<"date" | "time"> }
  | { intent: "reminder"; message?: string; date?: string; time?: string; missing: Array<"date" | "time"> }
  | { intent: "expense"; amount?: number; description?: string; category?: string; missing: Array<"amount" | "description"> }
  | {
      intent: "installment_expense";
      description?: string;
      category?: string;
      payment_method?: string;
      date?: string;
      totalAmount?: number;
      installmentAmount?: number;
      installments?: number;
      // "category" so aparece sozinho aqui, depois que os outros 3 ja foram
      // resolvidos e a categoria nao deu pra adivinhar (ver finalizeInstallmentExpense)
      missing: Array<"amount" | "description" | "installments" | "category">;
    };

export type PendingCompletion = PendingCompletionIntent & { createdAt: number };

const queues = new Map<string, PendingCompletion[]>();

function pruneExpired(fromNumber: string) {
  const queue = queues.get(fromNumber);
  if (!queue) return;
  while (queue.length && Date.now() - queue[0].createdAt > TTL_MS) queue.shift();
}

// Adiciona no fim da fila. Retorna true se virou o item da vez (fila estava
// vazia antes), pra quem chamou saber se deve perguntar agora ou so guardar
// pra perguntar depois que o(s) anterior(es) forem resolvidos.
export function addPendingCompletion(fromNumber: string, data: PendingCompletionIntent): boolean {
  pruneExpired(fromNumber);
  const queue = queues.get(fromNumber) ?? [];
  const wasEmpty = queue.length === 0;
  queue.push({ ...data, createdAt: Date.now() });
  queues.set(fromNumber, queue);
  return wasEmpty;
}

export function getNextPendingCompletion(fromNumber: string): PendingCompletion | null {
  pruneExpired(fromNumber);
  const queue = queues.get(fromNumber);
  return queue?.[0] ?? null;
}

// Substitui o item da vez (mesma posicao na fila), reiniciando o TTL -- usado
// depois de um ajuste parcial (ex: respondeu so o dia, ainda falta a hora).
export function updatePendingCompletionHead(fromNumber: string, data: PendingCompletionIntent) {
  const queue = queues.get(fromNumber);
  if (!queue || queue.length === 0) return;
  queue[0] = { ...data, createdAt: Date.now() };
}

// Remove o item da vez (resolvido ou cancelado). O proximo da fila, se
// houver, vira automaticamente o novo item da vez.
export function clearHeadPendingCompletion(fromNumber: string): PendingCompletion | null {
  const queue = queues.get(fromNumber);
  if (!queue || queue.length === 0) return null;
  return queue.shift() ?? null;
}
