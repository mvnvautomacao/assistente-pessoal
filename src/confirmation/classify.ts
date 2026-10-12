// Classificador unico da resposta a uma confirmacao de edicao. Funcao pura,
// sem I/O e sem IA: a mesma regra vale pra toda confirmacao (gasto, categoria,
// evento, lembrete, gasto fixo) e pode ser reaproveitada por outras (exclusao,
// recategorizacao em lote) depois.
//
// Regra: a mensagem INTEIRA precisa ser feita so de termos de confirmacao (ou so
// de cancelamento) pra contar como sim/nao. Qualquer outra coisa e texto livre --
// por isso "pode ser as 16h" (comeca com "pode"), "para sexta as 16h" e "nao, e
// as 16h" NUNCA sao lidos como sim/nao, e a correcao embutida nao se perde.

import { normalizeReply } from "./normalize";
import { parseChoiceNumber } from "./numbers";

// quem importava daqui continua importando (a funcao mora em ./normalize)
export { normalizeReply };

export type ConfirmationReply = "confirm" | "cancel" | "correct" | "free_text";

const CONFIRM_TERMS = new Set([
  "sim", "s", "1", "um", "uma", "confirmo", "confirma", "confirmar", "pode", "isso", "mesmo",
  "certo", "ok", "claro", "blz", "beleza", "fechado", "perfeito", "manda",
  "positivo", "certeza", "com",
]);

const CANCEL_TERMS = new Set(["nao", "n", "3", "tres", "cancela", "cancelar", "deixa", "pra", "la", "esquece", "negativo", "nem"]);

export function classifyConfirmationReply(text: string): ConfirmationReply {
  const normalized = normalizeReply(text);
  if (!normalized) return "free_text";

  // numero (digito ou por extenso, com ou sem "opcao"/"o"/"a"): 1 confirma, 2 corrige, 3 cancela
  const number = parseChoiceNumber(text);
  if (number === 1) return "confirm";
  if (number === 2) return "correct";
  if (number === 3) return "cancel";
  if (number !== null) return "free_text";
  if (normalized === "corrigir") return "correct";

  const tokens = normalized.split(" ");
  if (tokens.every((t) => CONFIRM_TERMS.has(t))) return "confirm";
  if (tokens.every((t) => CANCEL_TERMS.has(t))) return "cancel";
  return "free_text";
}

// durante "aguardando correcao" so a palavra "cancelar" cancela (ver RN06) --
// qualquer outra coisa, inclusive "1", "3" ou "nao", e o novo valor.
export function isCancelWord(text: string): boolean {
  return normalizeReply(text) === "cancelar";
}
