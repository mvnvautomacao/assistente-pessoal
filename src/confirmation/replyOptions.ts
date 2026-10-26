// Card 24: as opcoes de uma pergunta aberta (prévia 1/2/3, apagar 1/3, aviso de conta 1/2/3, perguntas fixas do cadastro). Quem sabe em que etapa a
// conversa esta (o resolvedor da pergunta) monta a ReplyQuestion e a entrega ao ponto unico handleNotUnderstood; a camada de interpretacao so pode
// sugerir uma opcao que exista aqui. Puro, sem banco nem IA.
import type { BillRecurrence } from "../bills/checkinReply";
import type { DeleteFlow } from "./deletePreview";
import { deleteFlowLabels, OTHER_OPTION_TEXT } from "./deletePreview";

export type ReplyIntent =
  | "confirm"
  | "correct"
  | "cancel"
  | "other"
  | "paid"
  | "snooze"
  | "skip"
  | "launch_self"
  | "alert_only"
  | "create_another"
  | "update_existing"
  | "launch_this_month"
  | "next_month_only";

export interface ReplyOption {
  number: 1 | 2 | 3;
  intent: ReplyIntent;
  label: string; // "✅ Já paguei" (aparece em "Entendi que foi *1 ✅ Já paguei*")
  destructive?: boolean; // apagar, cancelar evento, pular: nunca escolhida pela IA sem pedido explicito
}

// "kind" so ajusta o vocabulario do Nivel A (ex: no evento "cancelar o evento" CONFIRMA a exclusao)
export type ReplyQuestionKind = "preview" | "delete" | "delete_event" | "bill" | "recurrence";

export interface ReplyQuestion {
  kind: ReplyQuestionKind;
  text: string; // descricao curta da pergunta, usada no prompt da IA
  options: ReplyOption[];
  subject?: string; // quando ha fila de perguntas (varios avisos de conta): "Sobre *Luz*: ..."
}

export function previewReplyQuestion(subject?: string | null): ReplyQuestion {
  return {
    kind: "preview",
    text: `Prévia de uma alteração${subject ? ` de "${subject}"` : ""} pedindo para confirmar, corrigir ou cancelar`,
    options: [
      { number: 1, intent: "confirm", label: "✅ Confirmar" },
      { number: 2, intent: "correct", label: "✏️ Corrigir" },
      { number: 3, intent: "cancel", label: "❌ Cancelar" },
    ],
  };
}

export function deleteReplyQuestion(spec: { flow: DeleteFlow; offerOther?: boolean }): ReplyQuestion {
  const text = deleteFlowLabels(spec.flow);
  const options: ReplyOption[] = [{ number: 1, intent: "confirm", label: text.confirm, destructive: true }];
  if (spec.offerOther) options.push({ number: 2, intent: "other", label: OTHER_OPTION_TEXT });
  options.push({ number: 3, intent: "cancel", label: text.cancel });
  return {
    kind: spec.flow === "event" ? "delete_event" : "delete",
    text: `Confirmação para ${text.verb}: 1 confirma e executa, 3 desiste`,
    options,
  };
}

export function billReplyQuestion(name: string, recurrenceType: BillRecurrence, withSubject: boolean): ReplyQuestion {
  const interval = recurrenceType === "interval";
  return {
    kind: "bill",
    text: `Aviso "${name}": o cliente já ${interval ? "resolveu" : "pagou"}?`,
    subject: withSubject ? name : undefined,
    options: [
      { number: 1, intent: "paid", label: interval ? "✅ Já resolvi" : "✅ Já paguei" },
      { number: 2, intent: "snooze", label: "⏰ Ainda não, me lembra amanhã" },
      { number: 3, intent: "skip", label: interval ? "⏭️ Não vou fazer agora (pular)" : "⏭️ Não vou pagar este mês (pular)", destructive: true },
    ],
  };
}

export type RecurrenceReplyStep = "choose_type" | "duplicate" | "this_month";

export function recurrenceReplyQuestion(step: RecurrenceReplyStep): ReplyQuestion {
  if (step === "choose_type") {
    return {
      kind: "recurrence",
      text: "Cadastro de conta fixa: lançar o gasto sozinho todo mês ou só avisar?",
      options: [
        { number: 1, intent: "launch_self", label: "🔁 Lançar sozinho" },
        { number: 2, intent: "alert_only", label: "🔔 Só avisar" },
        { number: 3, intent: "cancel", label: "❌ Cancelar" },
      ],
    };
  }
  if (step === "duplicate") {
    return {
      kind: "recurrence",
      text: "Cadastro: já existe um parecido; cadastrar outro mesmo assim ou atualizar o existente?",
      options: [
        { number: 1, intent: "create_another", label: "➕ Cadastrar outro" },
        { number: 2, intent: "update_existing", label: "✏️ Atualizar o que já existe" },
        { number: 3, intent: "cancel", label: "❌ Cancelar" },
      ],
    };
  }
  return {
    kind: "recurrence",
    text: "Cadastro de gasto fixo: o dia deste mês já passou; lançar o deste mês agora ou só a partir do mês que vem?",
    options: [
      { number: 1, intent: "launch_this_month", label: "✅ Lançar o deste mês" },
      { number: 2, intent: "next_month_only", label: "⏭️ Só a partir do mês que vem" },
      { number: 3, intent: "cancel", label: "❌ Cancelar o cadastro" },
    ],
  };
}

export function optionByNumber(question: ReplyQuestion, number: number): ReplyOption | undefined {
  return question.options.find((o) => o.number === number);
}
