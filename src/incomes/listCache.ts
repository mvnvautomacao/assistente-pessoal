// Fachada da "ultima lista de entradas mostrada" (lists/lastShown.ts guarda as listas de gastos, entradas e agenda numa so): guarda quais
// entradas foram mostradas na ultima resposta de "list_incomes" pra cada numero, pra "muda o valor do 2" saber a quem se refere. Mesma
// ideia de expenses/listCache.ts -- e uma lista invalida a outra: o numero sempre vale para a ULTIMA lista mostrada.
import { clearLastShown, getLastShown, setLastShown } from "../lists/lastShown";

export function setLastShownIncomes(fromNumber: string, ids: number[], label?: string) {
  setLastShown(fromNumber, { kind: "income", ids, label });
}

export function getLastShownIncomes(fromNumber: string): number[] | null {
  const list = getLastShown(fromNumber);
  return list && list.kind === "income" ? list.ids : null;
}

export function clearLastShownIncomes(fromNumber: string) {
  clearLastShown(fromNumber, "income");
}
