// Card 17 (RN03, RN04, RN05, RF03): catalogo de frases soltas -- puro, por tabela.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLooseCommand,
  formatDateChoices,
  formatSuggestions,
  GENERIC_SUGGESTIONS,
  isActionWithoutData,
  looksLikeExpenseData,
  normalizeLoose,
  suggestionsFor,
  verbClassOf,
  LooseAction,
} from "../../src/intents/looseCommands";

const action = (text: string): LooseAction | undefined => {
  const result = classifyLooseCommand(text);
  return result && result.type === "action" ? result.action : undefined;
};

test("editar categoria / pagamento / valor: lista de gastos com o campo pre-selecionado", () => {
  for (const text of ["trocar categoria", "mudar categoria", "alterar a categoria", "quero trocar a categoria", "Trocar Categoria.", "troca a categoria", "corrige a categoria", "preciso mudar a categoria", "trocar categoria 😅", "Trocar categoria!!"]) {
    assert.deepEqual(action(text), { type: "edit", target: "expense", field: "category" }, text);
  }
  for (const text of ["trocar forma de pagamento", "mudar pagamento", "alterar a forma de pagamento", "trocar o cartão", "muda o cartao"]) {
    assert.deepEqual(action(text), { type: "edit", target: "expense", field: "payment_method" }, text);
  }
  for (const text of ["mudar valor", "corrigir o valor", "trocar o preço", "editar o preco"]) {
    assert.deepEqual(action(text), { type: "edit", target: "expense", field: "amount" }, text);
  }
});

test("editar gasto, evento, lembrete, conta fixa, gasto fixo e entrada: lista do tipo e menu de campos", () => {
  const table: [string, LooseAction][] = [
    ["editar gasto", { type: "edit", target: "expense" }],
    ["editar compra", { type: "edit", target: "expense" }],
    ["alterar a despesa", { type: "edit", target: "expense" }],
    ["editar evento", { type: "edit", target: "event" }],
    ["editar compromisso", { type: "edit", target: "event" }],
    ["mudar a reunião", { type: "edit", target: "event" }],
    ["editar lembrete", { type: "edit", target: "reminder" }],
    ["editar conta fixa", { type: "edit", target: "bill_alert" }],
    ["editar o alerta", { type: "edit", target: "bill_alert" }],
    ["editar alerta de conta", { type: "edit", target: "bill_alert" }],
    ["editar gasto fixo", { type: "edit", target: "recurring" }],
    ["editar entrada", { type: "edit", target: "income" }],
    ["mudar a receita", { type: "edit", target: "income" }],
    ["mudar data", { type: "ask_date" }],
    ["alterar o horário", { type: "ask_date" }],
    ["trocar o dia", { type: "ask_date" }],
  ];
  for (const [text, expected] of table) assert.deepEqual(action(text), expected, text);
});

test("apagar / excluir / deletar / remover: gasto, evento, lembrete, entrada, gasto fixo e conta fixa", () => {
  const table: [string, LooseAction][] = [
    ["apagar gasto", { type: "delete", target: "expense" }],
    ["excluir um gasto", { type: "delete", target: "expense" }],
    ["deletar a compra", { type: "delete", target: "expense" }],
    ["apaga evento", { type: "delete", target: "event" }],
    ["excluir evento", { type: "delete", target: "event" }],
    ["apagar lembrete", { type: "delete", target: "reminder" }],
    ["remover o lembrete", { type: "delete", target: "reminder" }],
    ["apagar entrada", { type: "delete", target: "income" }],
    ["apagar gasto fixo", { type: "delete", target: "recurring" }],
    ["remover conta fixa", { type: "delete", target: "bill_alert" }],
    ["quero apagar um gasto", { type: "delete", target: "expense" }],
  ];
  for (const [text, expected] of table) assert.deepEqual(action(text), expected, text);
});

test("ver / mostrar / listar: gastos, agenda, lembretes, categorias, pagamentos, entradas", () => {
  const table: [string, LooseAction][] = [
    ["ver meus gastos", { type: "view", what: "expenses" }],
    ["mostrar compras", { type: "view", what: "expenses" }],
    ["listar gastos", { type: "view", what: "expenses" }],
    ["minha agenda", { type: "view", what: "agenda" }],
    ["ver agenda", { type: "view", what: "agenda" }],
    ["ver eventos", { type: "view", what: "agenda" }],
    ["ver lembretes", { type: "view", what: "reminders" }],
    ["listar categorias", { type: "view", what: "categories" }],
    ["ver as categorias", { type: "view", what: "categories" }],
    ["ver formas de pagamento", { type: "view", what: "payment_methods" }],
    ["ver minhas entradas", { type: "view", what: "incomes" }],
  ];
  for (const [text, expected] of table) assert.deepEqual(action(text), expected, text);
});

test("palavra solta de categoria / pagamento / valor gera as sugestoes numeradas (RN04)", () => {
  const cat = classifyLooseCommand("categoria");
  assert.ok(cat && cat.type === "suggest");
  assert.deepEqual(cat.options.map((o) => o.label), ["Trocar a categoria de um gasto", "Ver minhas categorias", "Criar uma categoria"]);
  assert.deepEqual(cat.options[1].action, { type: "view", what: "categories" });
  assert.equal(
    formatSuggestions(cat.options),
    "Não tenho certeza do que você quer 🤔 Seria:\n1 Trocar a categoria de um gasto\n2 Ver minhas categorias\n3 Criar uma categoria\nResponde o número, ou diz o que você precisa."
  );
  for (const text of ["categorias", "a categoria", "pagamento", "forma de pagamento", "valor", "preço"]) {
    const result = classifyLooseCommand(text);
    assert.equal(result?.type, "suggest", text);
  }
  const apagarCategoria = classifyLooseCommand("apagar categoria");
  assert.ok(apagarCategoria && apagarCategoria.type === "suggest");
  assert.equal(apagarCategoria.options[0].label, "Apagar uma categoria");
  assert.equal(suggestionsFor("event", null), null);
  assert.equal(suggestionsFor("amount", "edit")?.length, 3);
  assert.equal(GENERIC_SUGGESTIONS.length, 3);
  assert.equal(formatDateChoices(), "Data de quê?\n1 Gasto   2 Evento   3 Lembrete");
});

test("o que NAO casa: frase completa, com numero/valor/data/nome, tipo sozinho, erro de digitacao, apagar tudo", () => {
  for (const text of [
    "troca a categoria do último gasto pra lazer",
    "trocar categoria do mercado",
    "muda o valor do 2 pra 45",
    "mudar valor 50",
    "apagar gasto de 30 reais",
    "apagar gasto dia 5",
    "editar gasto do mercado",
    "apagar tudo",
    "apagar todos os gastos",
    "trocar categora", // erro de digitacao: vai pra IA
    "gasto",
    "evento",
    "lembrete",
    "entrada",
    "editar",
    "trocar",
    "oi",
    "50 no mercado",
    "gastei 30 de uber",
    "quero poder trocar a categoria do gasto",
    "mudar o evento da consulta",
    "",
    "   ",
  ]) {
    assert.equal(classifyLooseCommand(text), null, `"${text}"`);
  }
});

test("normalizeLoose, verbClassOf e os helpers do RN05", () => {
  assert.equal(normalizeLoose("  Trocar  CATEGORIA?! 😅 "), "trocar categoria");
  assert.equal(normalizeLoose("Ação"), "acao");
  assert.equal(verbClassOf("quero apagar"), "delete");
  assert.equal(verbClassOf("trocar pagamento do pix"), "edit");
  assert.equal(verbClassOf("mostra"), "view");
  assert.equal(verbClassOf("mercado"), null);
  assert.equal(looksLikeExpenseData("gastei no mercado"), true);
  assert.equal(looksLikeExpenseData("paguei o uber"), true);
  assert.equal(looksLikeExpenseData("R$ cinquenta"), true);
  assert.equal(looksLikeExpenseData("30 no mercado"), true);
  assert.equal(looksLikeExpenseData("trocar categoria"), false);
  assert.equal(isActionWithoutData("trocar pagamento do pix"), true);
  assert.equal(isActionWithoutData("apagar isso"), true);
  assert.equal(isActionWithoutData("trocar o pagamento do gasto de 30"), false);
  assert.equal(isActionWithoutData("gastei trocando de carro"), false, "verbo de compra vence");
  assert.equal(isActionWithoutData("ver meus gastos"), false, "ver nao e editar/apagar");
  assert.equal(isActionWithoutData("mudar o pagamento de um gasto que fiz ontem no mercado da esquina"), false, "longa demais");
});
