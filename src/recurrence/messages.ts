// Mensagens do cadastro de gasto fixo e alerta de conta (Card 13): perguntas de preenchimento, previa
// 1/2/3, duplicata, "mes corrente" e sucesso. Funcoes puras que devolvem texto.
import { PREVIEW_OPTIONS, correctionQuestion, formatBRL, formatShortDate, recurringHeader } from "../confirmation/preview";
import { withExitHint } from "../pending/newRequest";
import { addDaysToDateString } from "../timeSP";
import { RecurrenceDraft, RecurrenceField, RecurrenceMode } from "./rules";

export const CANCELLED_TEXT = "Beleza, não cadastrei nada.";
const CANCEL_SUFFIX = "Ou responde *cancelar*.";

// "todo dia 10" / "a cada 45 dias"
export function scheduleLabel(draft: Pick<RecurrenceDraft, "dayOfMonth" | "intervalDays">): string {
  if (draft.intervalDays !== undefined) return `a cada ${draft.intervalDays} ${draft.intervalDays === 1 ? "dia" : "dias"}`;
  return `todo dia ${draft.dayOfMonth}`;
}

// ---------------------------------------------------------------------------
// perguntas de preenchimento (RN06)
// ---------------------------------------------------------------------------

export function fillQuestion(mode: RecurrenceMode, field: RecurrenceField, draft: RecurrenceDraft): string {
  const name = draft.description?.trim() || (mode === "bill_alert" ? "essa conta" : "esse gasto fixo");
  if (field === "description") {
    const known: string[] = [];
    if (draft.amount !== undefined) known.push(formatBRL(draft.amount));
    const schedule = draft.dayOfMonth !== undefined || draft.intervalDays !== undefined ? ` (${scheduleLabel(draft)})` : "";
    if (mode === "bill_alert") {
      if (!schedule) return `Qual é a conta ou o compromisso que eu devo te avisar? Pode mandar tudo junto, ex: *luz todo dia 5*. ${CANCEL_SUFFIX}`;
      return `Qual é o nome desse alerta${schedule}? (ex: luz, ração) ${CANCEL_SUFFIX}`;
    }
    if (known.length === 0 && !schedule) {
      return `Qual é o gasto fixo? Pode mandar tudo junto, ex: *internet 100 dia 10*. ${CANCEL_SUFFIX}`;
    }
    const withAmount = known.length ? ` de ${known[0]}` : "";
    return `Qual é o nome desse gasto fixo${withAmount}${schedule}? (ex: internet, academia) ${CANCEL_SUFFIX}`;
  }
  if (field === "amount") {
    return `Qual é o valor de ${name}${draft.dayOfMonth !== undefined ? ` (${scheduleLabel(draft)})` : ""}? (ex: 100 ou 99,90) ${CANCEL_SUFFIX}`;
  }
  // schedule
  if (mode === "recurring_expense") {
    return `Em que dia do mês devo lançar ${name}? (1 a 31) ${CANCEL_SUFFIX}`;
  }
  return `Quando devo te avisar de ${name}? Pode ser um dia do mês (ex: *dia 10*) ou um intervalo (ex: *a cada 45 dias*). ${CANCEL_SUFFIX}`;
}

// repete a pergunta depois de explicar o que nao serviu (RN07)
export function withProblem(problem: string | undefined, question: string): string {
  return problem ? `${problem}\n${question}` : question;
}

// ---------------------------------------------------------------------------
// tipo ambiguo (RN04)
// ---------------------------------------------------------------------------

export function chooseTypeQuestion(draft: RecurrenceDraft): string {
  return `Como você quer cadastrar *${draft.description}* (${scheduleLabel(draft)})?\n1 🔁 Lançar o gasto sozinho todo mês (preciso do valor)\n2 📌 Só me avisar no dia\n3 ❌ Cancelar`;
}

export const CHOOSE_TYPE_NOT_UNDERSTOOD = withExitHint("Não entendi 🤔 Responde *1* pra lançar sozinho, *2* pra só avisar ou *3* pra cancelar.");

// ---------------------------------------------------------------------------
// previa (RN11)
// ---------------------------------------------------------------------------

export interface PreviewContext {
  categoryName?: string | null;
  paymentName?: string | null;
  todayDate: string; // YYYY-MM-DD (SP)
}

export function previewText(mode: RecurrenceMode, draft: RecurrenceDraft, ctx: PreviewContext): string {
  if (mode === "bill_alert") {
    const next = draft.intervalDays !== undefined ? ` (próximo aviso: ${formatShortDate(addDaysToDateString(ctx.todayDate, draft.intervalDays))})` : "";
    const lines = [`📌 Cadastrar alerta`, `${draft.description} — ${scheduleLabel(draft)}${next}`];
    if (draft.ignoredAmount !== undefined) {
      lines.push(`Gasto fixo só funciona por dia do mês, então vou só te avisar ${scheduleLabel(draft)} (o valor não é guardado).`);
    }
    lines.push('Vou te perguntar "já fez?" nesse dia. Não lanço gasto.');
    return `${lines.join("\n")}\n\n${PREVIEW_OPTIONS}`;
  }
  const header = recurringHeader({ description: draft.description ?? "", amount: draft.amount ?? 0, dayOfMonth: draft.dayOfMonth ?? 0 });
  const extras: string[] = [];
  if (ctx.categoryName) extras.push(`Categoria: ${ctx.categoryName}`);
  if (ctx.paymentName) extras.push(`Pagamento: ${ctx.paymentName}`);
  const short = (draft.dayOfMonth ?? 0) > 28 ? " (nos meses mais curtos, no último dia)" : "";
  const lines = ["🔁 Cadastrar gasto fixo", header];
  if (extras.length) lines.push(extras.join(" · "));
  lines.push(`Vou lançar sozinho todo mês, às 7h do dia ${draft.dayOfMonth}${short}.`);
  return `${lines.join("\n")}\n\n${PREVIEW_OPTIONS}`;
}

// ---------------------------------------------------------------------------
// duplicata (RN10)
// ---------------------------------------------------------------------------

export function duplicateQuestion(mode: RecurrenceMode, existingLabel: string): string {
  const what = mode === "bill_alert" ? "o alerta" : "";
  return `Você já tem ${what ? `${what} ` : ""}*${existingLabel}*. O que faço?\n1 ➕ Cadastrar outro mesmo assim\n2 ✏️ Atualizar o que já existe\n3 ❌ Cancelar`;
}

export const DUPLICATE_NOT_UNDERSTOOD = withExitHint("Não entendi 🤔 Responde *1* pra cadastrar outro, *2* pra atualizar o que já existe ou *3* pra cancelar.");

// ---------------------------------------------------------------------------
// mes corrente (RN12)
// ---------------------------------------------------------------------------

export function thisMonthQuestion(day: number, amount: number, dueDate: string): string {
  return `O dia ${day} já passou neste mês. Quer que eu lance o deste mês agora?\n1 ✅ Sim, lançar ${formatBRL(amount)} (${formatShortDate(dueDate)})\n2 ➡️ Não, só a partir do mês que vem\n3 ❌ Cancelar o cadastro`;
}

export const THIS_MONTH_NOT_UNDERSTOOD = withExitHint("Não entendi 🤔 Responde *1* pra lançar o deste mês, *2* pra só a partir do mês que vem ou *3* pra cancelar o cadastro.");

// ---------------------------------------------------------------------------
// corrigir (opcao 2 da previa)
// ---------------------------------------------------------------------------

export type CorrectionField = "description" | "amount" | "schedule" | "category" | "payment";

export interface CorrectionChoice {
  field: CorrectionField;
  label: string;
}

export function correctionChoices(mode: RecurrenceMode): CorrectionChoice[] {
  if (mode === "bill_alert") {
    return [
      { field: "description", label: "Nome" },
      { field: "schedule", label: "Quando (dia ou intervalo)" },
    ];
  }
  return [
    { field: "description", label: "Nome" },
    { field: "amount", label: "Valor" },
    { field: "schedule", label: "Dia do mês" },
    { field: "category", label: "Categoria" },
    { field: "payment", label: "Pagamento" },
  ];
}

export function correctionValueQuestion(mode: RecurrenceMode, field: CorrectionField): string {
  switch (field) {
    case "description":
      return correctionQuestion("text", "nome");
    case "amount":
      return correctionQuestion("amount");
    case "schedule":
      return mode === "bill_alert"
        ? `Quando devo te avisar? (ex: *dia 10* ou *a cada 45 dias*) ${CANCEL_SUFFIX}`
        : correctionQuestion("day");
    case "category":
      return correctionQuestion("text", "categoria");
    case "payment":
      return correctionQuestion("text", "forma de pagamento");
  }
}

// ---------------------------------------------------------------------------
// sucesso (RN14)
// ---------------------------------------------------------------------------

export function recurringCreatedText(draft: RecurrenceDraft, categoryName: string, paymentName: string | null): string {
  const category = categoryName ? ` em ${categoryName}` : "";
  const payment = paymentName ? ` via ${paymentName}` : "";
  return `🔁 Gasto fixo cadastrado: ${formatBRL(draft.amount ?? 0)}${category}${payment} — ${draft.description}, todo dia ${draft.dayOfMonth}. Vou lançar esse valor todo dia ${draft.dayOfMonth} às 7h.`;
}

export function alertCreatedText(draft: RecurrenceDraft): string {
  return `📌 Alerta cadastrado: ${scheduleLabel(draft)} eu te pergunto se já fez "${draft.description}". Se ainda não tiver feito, é só pedir pra eu lembrar de novo no dia seguinte.`;
}

export const MULTIPLE_CREATIONS_NOTICE = "Vi mais de um cadastro; cuidei do primeiro. Manda o próximo depois.";
