// Registro dos campos editaveis de cada tipo de item no menu guiado "O que voce
// quer mudar?". UMA tabela por tipo define ordem, rotulo, tipo de pergunta e
// apelidos aceitos na selecao -- acrescentar um campo no futuro (ex: "Local")
// e so uma linha aqui.

export type MenuKind = "expense" | "event" | "reminder" | "recurring" | "income";

// como o valor de cada campo e perguntado e validado
export type FieldQuestion = "amount" | "date" | "datetime" | "lead" | "day" | "text" | "category" | "payment_method" | "endtime" | "location";

export interface FieldDef {
  key: string; // chave estavel usada em "collected" (para gasto = campo de edit_expense)
  label: string; // como aparece no menu
  question: FieldQuestion;
  noun: string; // palavra usada nas perguntas de texto ("Qual e o novo ...?")
  aliases: string[]; // alem do rotulo, sem acento e minusculas
}

export const FIELD_REGISTRY: Record<MenuKind, FieldDef[]> = {
  expense: [
    { key: "amount", label: "Valor", question: "amount", noun: "valor", aliases: ["valor", "preco"] },
    { key: "description", label: "Nome", question: "text", noun: "nome", aliases: ["nome", "descricao"] },
    { key: "category", label: "Categoria", question: "category", noun: "categoria", aliases: ["categoria"] },
    { key: "date", label: "Data", question: "date", noun: "data", aliases: ["data", "dia"] },
    { key: "payment_method", label: "Pagamento", question: "payment_method", noun: "forma de pagamento", aliases: ["pagamento", "forma de pagamento"] },
  ],
  income: [
    { key: "amount", label: "Valor", question: "amount", noun: "valor", aliases: ["valor", "preco"] },
    { key: "description", label: "Descrição", question: "text", noun: "descrição", aliases: ["descricao", "nome", "origem"] },
    { key: "date", label: "Data", question: "date", noun: "data", aliases: ["data", "dia"] },
  ],
  event: [
    { key: "datetime", label: "Dia e hora", question: "datetime", noun: "data e hora", aliases: ["dia e hora", "dia", "hora", "horario", "data", "quando"] },
    { key: "title", label: "Título", question: "text", noun: "título", aliases: ["titulo", "nome"] },
    { key: "lead", label: "Aviso", question: "lead", noun: "antecedência", aliases: ["aviso", "antecedencia"] },
    { key: "end", label: "Término", question: "endtime", noun: "término", aliases: ["termino", "fim", "duracao", "ate"] },
    { key: "location", label: "Local", question: "location", noun: "local", aliases: ["local", "endereco", "lugar"] },
  ],
  reminder: [
    { key: "datetime", label: "Dia e hora", question: "datetime", noun: "data e hora", aliases: ["dia e hora", "dia", "hora", "horario", "data", "quando"] },
    { key: "message", label: "Texto", question: "text", noun: "texto", aliases: ["texto", "mensagem", "nome"] },
  ],
  recurring: [
    { key: "description", label: "Nome", question: "text", noun: "nome", aliases: ["nome", "descricao"] },
    { key: "amount", label: "Valor", question: "amount", noun: "valor", aliases: ["valor", "preco"] },
    { key: "category", label: "Categoria", question: "category", noun: "categoria", aliases: ["categoria"] },
    { key: "day", label: "Dia do mês", question: "day", noun: "dia do mês", aliases: ["dia do mes", "dia", "vencimento"] },
    { key: "payment_method", label: "Pagamento", question: "payment_method", noun: "forma de pagamento", aliases: ["pagamento", "forma de pagamento"] },
  ],
};

export function getFieldDef(kind: MenuKind, key: string): FieldDef | undefined {
  return FIELD_REGISTRY[kind].find((f) => f.key === key);
}
