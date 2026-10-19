// Aviso de conta fixa e leitura da resposta (Card 15, RN16 a RN18). Puro, sem banco e sem I/O.
// O aviso traz uma lista 1/2/3 e a resposta e lida sobre a MENSAGEM INTEIRA: numero (digito ou por extenso) ou uma
// frase claramente de um dos tres sentidos. Qualquer outra coisa -- inclusive frase que mistura sentidos, como
// "nao, ja paguei" -- e "unclear": nunca fecha o ciclo nem adia sozinho.
import { parseChoiceNumber } from "../confirmation/numbers";
import { normalizeReply } from "../confirmation/normalize";

export type BillCheckinReply = "paid" | "snooze" | "skip" | "unclear";

export type BillRecurrence = "day_of_month" | "interval";

export interface BillQuestionInfo {
  name: string;
  recurrenceType: BillRecurrence;
  // dia cadastrado quando o aviso veio antecipado pro ultimo dia de um mes curto (Card 16, RN17)
  monthEndFromDay?: number | null;
  // vencimento que o servidor perdeu (Card 19): o aviso sai com "(atrasado: vencia dia ...)"
  lateFromDate?: string | null;
}

// frases CLARAS (ja normalizadas: sem acento, minusculas, sem pontuacao; "ta"/"esta" valem os dois)
const PAID_PHRASES = new Set([
  "sim", "s", "pago", "paguei", "ja paguei", "ta pago", "esta pago", "ja esta pago", "ja ta pago", "ja foi", "ja foi pago", "ja fiz", "fiz",
  "feito", "ja feito", "resolvido", "resolvi", "ja resolvi", "quitado", "quitei", "ja quitei", "comprei", "ja comprei", "ok pago", "ok paguei",
  "pago sim", "sim paguei", "sim ja paguei", "sim pago", "confirmo", "confirma", "tudo pago", "paguei sim",
]);

const SNOOZE_PHRASES = new Set([
  "nao", "n", "ainda nao", "ainda nao paguei", "nao paguei", "ainda nao fiz", "nao fiz", "nao comprei", "ainda nao comprei", "depois", "mais tarde",
  "amanha", "me lembra amanha", "me lembra", "lembra", "lembra amanha", "manda amanha", "esqueci", "ainda nao resolvi", "nao resolvi",
  "ainda nao lembra amanha", "ainda nao me lembra amanha", "ainda nao amanha", "nao lembra amanha", "nao me lembra amanha", "nao amanha",
  "ainda nao lembra depois", "ainda nao me lembra depois", "ainda nao paguei lembra amanha", "ainda nao paguei me lembra amanha", "nao paguei amanha",
  "ainda nao lembre amanha", "ainda nao me lembre amanha", "me lembre amanha", "lembre amanha", "lembre",
]);

const SKIP_PHRASES = new Set([
  "pular", "pula", "pulei", "nao vou pagar", "nao vou pagar esse mes", "esse mes nao", "este mes nao", "nao vou comprar", "nao vou fazer",
  "nao vou fazer agora", "pular esse mes", "pula esse mes", "pular este mes",
]);

export function classifyBillCheckinReply(text: string): BillCheckinReply {
  const number = parseChoiceNumber(text);
  if (number !== null) {
    if (number === 1) return "paid";
    if (number === 2) return "snooze";
    if (number === 3) return "skip";
    return "unclear";
  }
  const normalized = normalizeReply(text);
  if (!normalized) return "unclear";
  if (SKIP_PHRASES.has(normalized)) return "skip";
  if (SNOOZE_PHRASES.has(normalized)) return "snooze";
  if (PAID_PHRASES.has(normalized)) return "paid";
  return "unclear";
}

// as tres linhas da lista (RN16): o texto muda um pouco no alerta por intervalo
export function billCheckinOptions(recurrenceType: BillRecurrence): string {
  const paid = recurrenceType === "interval" ? "Já resolvi" : "Já paguei";
  const skip = recurrenceType === "interval" ? "Não vou fazer agora (pular)" : "Não vou pagar este mês (pular)";
  return `1 ✅ ${paid}\n2 ⏰ Ainda não, me lembra amanhã\n3 ⏭️ ${skip}`;
}

// " (atrasado: vencia dia 10)" (dia do mes) ou " (atrasado: vencia dia 05/10)" (intervalo)
export function lateNote(bill: Pick<BillQuestionInfo, "recurrenceType" | "lateFromDate">): string {
  if (!bill.lateFromDate) return "";
  const [, month, day] = bill.lateFromDate.split("-");
  return bill.recurrenceType === "interval" ? ` (atrasado: vencia dia ${day}/${month})` : ` (atrasado: vencia dia ${day})`;
}

// o aviso enviado pelo scheduler
export function buildBillAlertQuestion(bill: BillQuestionInfo): string {
  const late = lateNote(bill);
  const head =
    bill.recurrenceType === "interval"
      ? `📌 Hora de: ${bill.name}${late}.`
      : bill.monthEndFromDay
        ? `📌 Hoje é o último dia do mês (vence todo dia ${bill.monthEndFromDay}): ${bill.name}.`
        : `📌 Hoje é dia de pagar: ${bill.name}${late}.`;
  return `${head}\n${billCheckinOptions(bill.recurrenceType)}`;
}

// resposta que nao foi entendida: repete a lista (cita a conta quando ha mais de um aviso esperando)
export function billCheckinRepeat(bill: BillQuestionInfo, options: { mentionName?: boolean } = {}): string {
  const lead = options.mentionName ? `Não entendi 🤔 Sobre *${bill.name}*, responde *1*, *2* ou *3*:` : "Não entendi 🤔 Responde *1*, *2* ou *3*:";
  return `${lead}\n${billCheckinOptions(bill.recurrenceType)}`;
}
