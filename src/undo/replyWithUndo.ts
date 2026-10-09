// Dica de "desfazer" nas mensagens de sucesso de toda acao que registra desfazer
// (RN11). Uma constante so, e um helper so, pra nao espalhar a frase pelo router.
import { sendText } from "../whatsapp/client";

export const UNDO_HINT = "Errou? Responde *desfazer*.";

// acrescenta a dica em linha propria no fim, sem duplicar se o texto ja a contem
export function withUndoHint(text: string): string {
  return text.includes(UNDO_HINT) ? text : `${text}\n${UNDO_HINT}`;
}

export async function replyWithUndo(to: string, text: string) {
  return sendText(to, withUndoHint(text));
}
