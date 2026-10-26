// Os testes do aviso de gasto pendente dividem o mesmo banco: a rodada do agendador processa TODOS os assinantes. Este helper desliga, so durante
// a chamada, o aviso de quem nao esta na lista (direto no banco, sem zerar nada) e restaura depois -- a funcao de producao fica sem filtro.
import { db } from "../../src/db";

export async function onlyFor<T>(numbers: string[], fn: () => Promise<T>): Promise<T> {
  const keep = new Set(numbers);
  const others = (db.prepare(`SELECT from_number FROM user_settings WHERE no_expense_reminder_enabled = 1`).all() as { from_number: string }[])
    .map((r) => r.from_number)
    .filter((n) => !keep.has(n));
  const set = db.prepare(`UPDATE user_settings SET no_expense_reminder_enabled = ? WHERE from_number = ?`);
  for (const n of others) set.run(0, n);
  try {
    return await fn();
  } finally {
    for (const n of others) set.run(1, n);
  }
}
