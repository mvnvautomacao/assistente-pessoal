import { db } from "../db";
import { getIncomeSummaryBetween } from "../incomes/service";

// "Cartao" = qualquer forma de pagamento cujo nome cite cartao/credito/debito,
// OU que o usuario tenha dado um limite. Gasto no cartao NAO abate das entradas
// (so do limite do cartao, se o usuario informou um); Pix, dinheiro e o resto
// (inclusive gasto sem forma de pagamento) abatem das entradas do mes.
export function isCardMethodName(name: string): boolean {
  return /cart[aã]o|cartao|cr[eé]dito|credito|d[eé]bito|debito/i.test(name);
}

export interface CardStatus {
  id: number;
  name: string;
  limit: number;
  spent: number;
  available: number;
}

export interface MonthBalance {
  incomeTotal: number;
  spentNonCard: number;
  spentCard: number;
  balance: number; // entradas - gastos que NAO sao no cartao
  // so cartoes em que o usuario informou o limite -- sem limite, nao entra
  cards: CardStatus[];
}

export function setPaymentMethodLimit(fromNumber: string, paymentMethodId: number, limit: number | null) {
  db.prepare(`UPDATE payment_methods SET credit_limit = ? WHERE id = ? AND from_number = ?`).run(limit, paymentMethodId, fromNumber);
}

// mes inteiro ("YYYY-MM") -- usado pelo painel inicial
export function getMonthBalance(fromNumber: string, yearMonth: string): MonthBalance {
  const [y, m] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return getRangeBalance(fromNumber, start, end);
}

// [start, end) -- mesmo criterio de reportText.ts (fim exclusivo); usado tambem
// pelo "qual meu saldo" do WhatsApp
export function getRangeBalance(fromNumber: string, start: string, end: string): MonthBalance {
  const methods = db
    .prepare(`SELECT id, name, credit_limit FROM payment_methods WHERE from_number = ?`)
    .all(fromNumber) as unknown as { id: number; name: string; credit_limit: number | null }[];
  const byId = new Map(methods.map((m) => [m.id, m]));

  const spending = db
    .prepare(
      `SELECT payment_method_id AS id, SUM(amount) AS total
       FROM expenses WHERE from_number = ? AND date >= ? AND date < ?
       GROUP BY payment_method_id`
    )
    .all(fromNumber, start, end) as unknown as { id: number | null; total: number }[];

  let spentNonCard = 0;
  let spentCard = 0;
  const spentByCard = new Map<number, number>();
  for (const row of spending) {
    const method = row.id !== null ? byId.get(row.id) : undefined;
    const isCard = method ? isCardMethodName(method.name) || method.credit_limit !== null : false;
    if (isCard && method) {
      spentCard += row.total;
      spentByCard.set(method.id, row.total);
    } else {
      spentNonCard += row.total;
    }
  }

  const cards: CardStatus[] = methods
    .filter((m) => m.credit_limit !== null)
    .map((m) => {
      const spent = spentByCard.get(m.id) ?? 0;
      return { id: m.id, name: m.name, limit: m.credit_limit!, spent, available: m.credit_limit! - spent };
    });

  const incomeTotal = getIncomeSummaryBetween(start, end, fromNumber).total;
  return { incomeTotal, spentNonCard, spentCard, balance: incomeTotal - spentNonCard, cards };
}
