// Mensagens do menu guiado de campos: o menu em si, a pergunta de cada campo
// (com "(i de n)") e o aviso de selecao invalida. Funcoes puras.
import { CorrectionKind, correctionQuestion } from "../confirmation/preview";
import { FIELD_REGISTRY, FieldDef, FieldQuestion, MenuKind } from "./registry";

export const FIELD_SELECTION_RETRY = "Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.";

// no maximo isso de categorias/formas de pagamento listadas na pergunta de escolha
export const MAX_CHOICE_OPTIONS = 8;

export function formatFieldMenu(header: string, kind: MenuKind): string {
  const fields = FIELD_REGISTRY[kind];
  const lines = fields.map((f, idx) => `${idx + 1} ${f.label}`).join("\n");
  return `✏️ ${header}\nO que você quer mudar?\n${lines}\n\nPode escolher mais de um: "1 e ${fields.length}". Ou *cancelar*.`;
}

export function isChoiceQuestion(question: FieldQuestion): boolean {
  return question === "category" || question === "payment_method";
}

const CORRECTION_KIND: Record<Exclude<FieldQuestion, "category" | "payment_method">, CorrectionKind> = {
  amount: "amount",
  date: "date",
  datetime: "datetime",
  lead: "lead",
  day: "day",
  text: "text",
  endtime: "endtime",
  location: "location",
};

// pergunta de UM campo; "options" so vale pra categoria e forma de pagamento
export function formatFieldQuestion(params: { def: FieldDef; step: number; total: number; options?: string[] }): string {
  const { def, step, total } = params;
  const prefix = total > 1 ? `(${step} de ${total}) ` : "";
  if (isChoiceQuestion(def.question)) {
    const title = def.question === "category" ? "Qual categoria?" : "Qual forma de pagamento?";
    const options = params.options ?? [];
    const list = options.length ? `${options.map((name, idx) => `${idx + 1}. ${name}`).join("\n")}\n` : "";
    const how = options.length ? "Responde com o número ou escreve o nome" : "Escreve o nome";
    return `${prefix}${title}\n${list}${how} (se não existir, eu só crio depois que você confirmar). Ou *cancelar*.`;
  }
  return `${prefix}${correctionQuestion(CORRECTION_KIND[def.question as keyof typeof CORRECTION_KIND], def.noun)}`;
}

// resposta que nao serviu: o motivo + a mesma pergunta de novo
export function formatFieldRetry(error: string, params: { def: FieldDef; step: number; total: number; options?: string[] }): string {
  return `${error}\n${formatFieldQuestion(params)}`;
}
