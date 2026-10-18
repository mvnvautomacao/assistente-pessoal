// Frases soltas de funcionalidade (Card 17): "trocar categoria", "apagar gasto", "mudar data", "categoria"... Mensagem curta
// (ate 5 palavras), sem numero, valor, data nem nome proprio, que so NOMEIA o que o usuario quer fazer. Modulo puro e local:
// nao usa a IA (sem custo e sem variacao). Frase completa ("troca a categoria do ultimo gasto pra lazer") nao casa aqui e
// segue pra IA como sempre.

export type LooseTarget = "expense" | "event" | "reminder" | "bill_alert" | "recurring" | "income";
export type LooseField = "category" | "payment_method" | "amount" | "date";

export type LooseAction =
  | { type: "edit"; target: LooseTarget; field?: LooseField }
  | { type: "delete"; target: LooseTarget }
  | { type: "ask_date" } // "Data de quê? 1 Gasto 2 Evento 3 Lembrete"
  | { type: "view"; what: "expenses" | "agenda" | "reminders" | "categories" | "payment_methods" | "incomes" }
  | { type: "hint"; text: string }; // explicacao curta (ex: como criar uma categoria)

export interface LooseOption {
  label: string;
  action: LooseAction;
}

export type LooseResult = { type: "action"; action: LooseAction } | { type: "suggest"; options: LooseOption[] } | null;

export const MAX_LOOSE_WORDS = 5;

type VerbClass = "edit" | "delete" | "view";

const VERBS: Record<string, VerbClass> = {
  trocar: "edit", troca: "edit", mudar: "edit", muda: "edit", alterar: "edit", altera: "edit", corrigir: "edit", corrige: "edit",
  editar: "edit", edita: "edit", ajustar: "edit", ajusta: "edit", atualizar: "edit", atualiza: "edit",
  apagar: "delete", apaga: "delete", excluir: "delete", exclui: "delete", deletar: "delete", deleta: "delete", remover: "delete", remove: "delete",
  ver: "view", mostrar: "view", mostra: "view", listar: "view", lista: "view",
};

const LEAD_PHRASES = ["eu quero", "eu preciso", "quero", "preciso", "queria", "vou", "posso", "gostaria de"];
const ARTICLES = new Set(["o", "a", "os", "as", "um", "uma", "uns", "umas", "meu", "minha", "meus", "minhas", "seu", "sua"]);

type Noun = "category" | "payment" | "amount" | "recurring" | "bill" | "expense" | "event" | "reminder" | "income" | "date" | "agenda";

const NOUNS: Record<string, Noun> = {
  categoria: "category", categorias: "category",
  "forma de pagamento": "payment", "formas de pagamento": "payment", pagamento: "payment", pagamentos: "payment", cartao: "payment",
  valor: "amount", preco: "amount",
  "gasto fixo": "recurring", "gastos fixos": "recurring", "despesa fixa": "recurring", "despesas fixas": "recurring",
  "conta fixa": "bill", "contas fixas": "bill", alerta: "bill", alertas: "bill", "alerta de conta": "bill", "alertas de conta": "bill",
  gasto: "expense", gastos: "expense", compra: "expense", compras: "expense", despesa: "expense", despesas: "expense",
  evento: "event", eventos: "event", compromisso: "event", compromissos: "event", reuniao: "event", reunioes: "event",
  lembrete: "reminder", lembretes: "reminder",
  entrada: "income", entradas: "income", receita: "income", receitas: "income",
  data: "date", dia: "date", horario: "date", hora: "date",
  agenda: "agenda",
};

// so estes substantivos, SOZINHOS, geram sugestoes (os demais -- "gasto", "evento", "lembrete" -- ja tem resposta propria)
const SUGGEST_ON_BARE: ReadonlySet<Noun> = new Set(["category", "payment", "amount"]);

export function normalizeLoose(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLead(words: string[]): string[] {
  const joined = words.join(" ");
  for (const lead of LEAD_PHRASES) {
    if (joined === lead) return [];
    if (joined.startsWith(`${lead} `)) return joined.slice(lead.length + 1).split(" ");
  }
  return words;
}

const hasDigits = (text: string) => /\d|r\$/i.test(text);

// um dos verbos de editar / apagar / ver aparece na mensagem?
export function verbClassOf(text: string): VerbClass | null {
  for (const word of normalizeLoose(text).split(" ")) if (VERBS[word]) return VERBS[word];
  return null;
}

// palavras que indicam um gasto de verdade sendo relatado (RN05)
const PURCHASE_WORDS = /\b(comprei|gastei|paguei|pago|gasto de|gastou|comprou|pagou)\b/;
export function looksLikeExpenseData(text: string): boolean {
  return hasDigits(text) || PURCHASE_WORDS.test(normalizeLoose(text));
}

// frase curta com verbo de editar/apagar e SEM dados: nunca e "gasto novo" (RN05)
export function isActionWithoutData(text: string): boolean {
  const verb = verbClassOf(text);
  return (verb === "edit" || verb === "delete") && !looksLikeExpenseData(text) && normalizeLoose(text).split(" ").length <= MAX_LOOSE_WORDS;
}

function opt(label: string, action: LooseAction): LooseOption {
  return { label, action };
}

const CREATE_CATEGORY_HINT: LooseAction = { type: "hint", text: 'Me diz o nome da nova categoria, ex: "cria uma categoria chamada Pets".' };
const DELETE_CATEGORY_HINT: LooseAction = { type: "hint", text: 'Me diz qual categoria apagar, ex: "apaga a categoria Pets". Os gastos dela vão para "Outros".' };
const PAYMENT_DEFAULT_HINT: LooseAction = { type: "hint", text: 'Me diz qual, ex: "meu pagamento padrão é pix".' };

// RN04: ate 3 opcoes derivadas do substantivo (e do verbo, quando ele muda o que faz sentido)
export function suggestionsFor(noun: Noun, verb: VerbClass | null): LooseOption[] | null {
  if (noun === "category") {
    if (verb === "delete") {
      return [opt("Apagar uma categoria", DELETE_CATEGORY_HINT), opt("Ver minhas categorias", { type: "view", what: "categories" }), opt("Trocar a categoria de um gasto", { type: "edit", target: "expense", field: "category" })];
    }
    return [opt("Trocar a categoria de um gasto", { type: "edit", target: "expense", field: "category" }), opt("Ver minhas categorias", { type: "view", what: "categories" }), opt("Criar uma categoria", CREATE_CATEGORY_HINT)];
  }
  if (noun === "payment") {
    return [
      opt("Trocar a forma de pagamento de um gasto", { type: "edit", target: "expense", field: "payment_method" }),
      opt("Ver minhas formas de pagamento", { type: "view", what: "payment_methods" }),
      opt("Mudar a forma de pagamento padrão", PAYMENT_DEFAULT_HINT),
    ];
  }
  if (noun === "amount") {
    return [opt("Trocar o valor de um gasto", { type: "edit", target: "expense", field: "amount" }), opt("Trocar o valor de um gasto fixo", { type: "edit", target: "recurring" }), opt("Trocar o valor de uma entrada", { type: "edit", target: "income" })];
  }
  return null;
}

export const GENERIC_SUGGESTIONS: LooseOption[] = [
  opt("Editar um gasto", { type: "edit", target: "expense" }),
  opt("Apagar um gasto", { type: "delete", target: "expense" }),
  opt("Ver meus últimos gastos", { type: "view", what: "expenses" }),
];

export const DATE_CHOICES: LooseOption[] = [
  opt("Gasto", { type: "edit", target: "expense", field: "date" }),
  opt("Evento", { type: "edit", target: "event" }),
  opt("Lembrete", { type: "edit", target: "reminder" }),
];

function editAction(noun: Noun): LooseAction | null {
  switch (noun) {
    case "category": return { type: "edit", target: "expense", field: "category" };
    case "payment": return { type: "edit", target: "expense", field: "payment_method" };
    case "amount": return { type: "edit", target: "expense", field: "amount" };
    case "expense": return { type: "edit", target: "expense" };
    case "event": return { type: "edit", target: "event" };
    case "reminder": return { type: "edit", target: "reminder" };
    case "bill": return { type: "edit", target: "bill_alert" };
    case "recurring": return { type: "edit", target: "recurring" };
    case "income": return { type: "edit", target: "income" };
    case "date": return { type: "ask_date" };
    default: return null;
  }
}

function deleteAction(noun: Noun): LooseAction | null {
  switch (noun) {
    case "expense": return { type: "delete", target: "expense" };
    case "event": return { type: "delete", target: "event" };
    case "reminder": return { type: "delete", target: "reminder" };
    case "bill": return { type: "delete", target: "bill_alert" };
    case "recurring": return { type: "delete", target: "recurring" };
    case "income": return { type: "delete", target: "income" };
    default: return null;
  }
}

function viewAction(noun: Noun): LooseAction | null {
  switch (noun) {
    case "expense": return { type: "view", what: "expenses" };
    case "event":
    case "agenda": return { type: "view", what: "agenda" };
    case "reminder": return { type: "view", what: "reminders" };
    case "category": return { type: "view", what: "categories" };
    case "payment": return { type: "view", what: "payment_methods" };
    case "income": return { type: "view", what: "incomes" };
    default: return null;
  }
}

export function classifyLooseCommand(text: string): LooseResult {
  if (hasDigits(text)) return null;
  const all = normalizeLoose(text).split(" ").filter(Boolean);
  if (all.length === 0 || all.length > MAX_LOOSE_WORDS) return null;

  const words = stripLead(all);
  if (words.length === 0) return null;

  // sem verbo: "minha agenda" e os substantivos que pedem sugestao ("categoria")
  const verb = VERBS[words[0]] ?? null;
  let rest = verb ? words.slice(1) : words;
  while (rest.length > 1 && ARTICLES.has(rest[0])) rest = rest.slice(1);
  if (rest.length === 0) return null;
  const noun = NOUNS[rest.join(" ")];
  if (!noun) return null;

  if (!verb) {
    if (noun === "agenda" && (words[0] === "minha" || words[0] === "a")) return { type: "action", action: { type: "view", what: "agenda" } };
    if (SUGGEST_ON_BARE.has(noun)) {
      const options = suggestionsFor(noun, null);
      return options ? { type: "suggest", options } : null;
    }
    return null;
  }

  const action = verb === "edit" ? editAction(noun) : verb === "delete" ? deleteAction(noun) : viewAction(noun);
  if (action) return { type: "action", action };
  const options = suggestionsFor(noun, verb);
  return options ? { type: "suggest", options } : null;
}

// "Não tenho certeza do que você quer 🤔 Seria:\n1 ...\nResponde o número, ou diz o que você precisa."
export function formatSuggestions(options: LooseOption[]): string {
  return `Não tenho certeza do que você quer 🤔 Seria:\n${options.map((o, i) => `${i + 1} ${o.label}`).join("\n")}\nResponde o número, ou diz o que você precisa.`;
}

export function formatDateChoices(): string {
  return `Data de quê?\n${DATE_CHOICES.map((o, i) => `${i + 1} ${o.label}`).join("   ")}`;
}
