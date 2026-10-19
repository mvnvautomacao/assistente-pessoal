// Fachada da "ultima lista de gastos mostrada" (lists/lastShown.ts guarda as listas de gastos, entradas e agenda numa so): guarda
// quais gastos foram mostrados na ultima resposta de "list_expenses" pra cada numero, pra "edita o 2" saber a quem se refere.
// Nao precisa sobreviver a um restart nem durar muito -- se o numero mandar qualquer outra coisa no meio, o router invalida
// (ver handleInterpretation).
import { clearLastShown, getLastShown, setLastShown } from "../lists/lastShown";

export function setLastShownExpenses(fromNumber: string, ids: number[], label?: string) {
  setLastShown(fromNumber, { kind: "expense", ids, label }); // uma lista invalida as outras
}

// descricao do periodo da ultima lista mostrada (ex: "18/09/2026 a 21/09/2026"),
// pra "qual o total?" logo em seguida poder dizer de que periodo e a soma
export function getLastShownLabel(fromNumber: string): string | null {
  const list = getLastShown(fromNumber);
  return list && list.kind === "expense" ? (list.label ?? null) : null;
}

export function getLastShownExpenses(fromNumber: string): number[] | null {
  const list = getLastShown(fromNumber);
  return list && list.kind === "expense" ? list.ids : null;
}

export function clearLastShownExpenses(fromNumber: string) {
  clearLastShown(fromNumber, "expense");
}
