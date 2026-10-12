import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NUMBER_WORDS, looksLikeMultipleNumbers, numberFromToken, parseChoiceNumber } from "../../src/confirmation/numbers";
import { normalizeReply } from "../../src/confirmation/normalize";
import { classifyConfirmationReply, normalizeReply as normalizeReplyFromClassify } from "../../src/confirmation/classify";
import * as targetReply from "../../src/targetChoice/reply";
import { interpretDeleteReply } from "../../src/confirmation/deletePreview";
import { parseFieldSelection } from "../../src/fieldMenu/select";
import { replyShape } from "../../src/pending/expiredNotice";

test("NUMBER_WORDS: tabela unica de um a dez, chaves sem acento", () => {
  assert.deepEqual(NUMBER_WORDS, { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 });
  assert.equal(numberFromToken("tres"), 3);
  assert.equal(numberFromToken("12"), 12);
  assert.equal(numberFromToken("onze"), null);
  assert.equal(numberFromToken("constructor"), null, "propriedades herdadas nao contam");
  assert.equal(numberFromToken(""), null);
});

test("parseChoiceNumber: digitos, extenso, acento, caixa, pontuacao e prefixos", () => {
  const cases: [string, number | null][] = [
    ["1", 1], ["02", 2], ["2.", 2], ["Um.", 1], ["UM", 1], ["um!", 1], ["uma", 1], ["Dois", 2], ["duas", 2], ["três", 3], ["tres", 3], ["TRÊS", 3],
    ["dez", 10], ["nove", 9], ["opção 4", 4], ["opção um", 1], ["número três", 3], ["numero tres", 3], ["item dois", 2], ["o 1", 1], ["a 3", 3], ["o um", 1], ["a um", 1],
    ["quatro", 4], ["", null], ["   ", null], ["a casa", null], ["2 3", null], ["um pouco", null], ["dois dias", null], ["três vezes", null], ["sim um", null], ["onze", null], ["o", null],
  ];
  for (const [text, expected] of cases) assert.equal(parseChoiceNumber(text), expected, `"${text}"`);
});

test("looksLikeMultipleNumbers: so numeros (digito ou extenso) ligados por 'e' ou virgula, dois ou mais", () => {
  for (const text of ["1 e 5", "1,2", "um e dois", "um dois", "1 e dois", "3 e 4 e 5"]) assert.equal(looksLikeMultipleNumbers(text), true, text);
  for (const text of ["1", "um", "e", "um pouco", "1 e abc", "", "dois dias"]) assert.equal(looksLikeMultipleNumbers(text), false, text);
});

test("classifyConfirmationReply: digitos e numeros por extenso (RN06)", () => {
  const cases: [string[], string][] = [
    [["1", "Um.", "um", "UM", "um!", "uma", "opção um", "opcao 1", "o 1", "a um", "número um", "item 1", "sim um", "um ok"], "confirm"],
    [["2", "dois", "Dois.", "duas", "opção dois", "número 2", "item dois", "o 2", "corrigir", "02"], "correct"],
    [["3", "três", "tres", "Três!", "número três", "item 3", "a 3", "o três", "não três", "cancelar tres"], "cancel"],
    [["um pouco", "dois dias", "três vezes", "uma hora", "4", "quatro", "dez", "5", "um três", "2 3", "pode ser um", "1 e 3", "um e dois"], "free_text"],
  ];
  for (const [texts, expected] of cases) {
    for (const text of texts) assert.equal(classifyConfirmationReply(text), expected, `"${text}"`);
  }
});

test("classifyConfirmationReply: as palavras ja aceitas nao mudam e a regra de mensagem INTEIRA continua", () => {
  for (const text of ["sim", "Sim!", "ok", "pode", "👍", "com certeza"]) assert.equal(classifyConfirmationReply(text), "confirm", text);
  for (const text of ["não", "cancelar", "deixa pra lá", "❌"]) assert.equal(classifyConfirmationReply(text), "cancel", text);
  for (const text of ["pode ser amanhã", "sim, mas só o do dia 10", "não, é o outro", "", "   "]) assert.equal(classifyConfirmationReply(text), "free_text", text);
});

test("modulos compartilhados: os nomes antigos continuam exportados dos mesmos lugares", () => {
  assert.equal(normalizeReplyFromClassify, normalizeReply);
  assert.equal(targetReply.parseChoiceNumber, parseChoiceNumber);
  assert.equal(targetReply.looksLikeMultipleNumbers, looksLikeMultipleNumbers);
  assert.equal(normalizeReply("  Não,   É às 16h!! "), "nao e as 16h");
  assert.equal(normalizeReply("👍"), "sim");
  assert.equal(normalizeReply("❌"), "nao");
});

test("interpretDeleteReply: 'um' apaga, 'tres' cancela, 'dois' so vale quando o fluxo oferece a opcao 2 (RN08)", () => {
  assert.equal(interpretDeleteReply("um", false), "confirm");
  assert.equal(interpretDeleteReply("Um.", false), "confirm");
  assert.equal(interpretDeleteReply("três", false), "cancel");
  assert.equal(interpretDeleteReply("dois", false), "not_understood", "so 1 e 3 existem");
  assert.equal(interpretDeleteReply("duas", false), "not_understood");
  assert.equal(interpretDeleteReply("dois", true), "other");
  assert.equal(interpretDeleteReply("opção dois", true), "other");
  assert.equal(interpretDeleteReply("um", true), "confirm");
  assert.equal(interpretDeleteReply("três", true), "cancel");
  assert.equal(interpretDeleteReply("um pouco", true), "not_understood");
  assert.equal(interpretDeleteReply("corrigir", true), "not_understood");
});

test("parseFieldSelection: usa a tabela unica ('um e dois' funciona; 'seis' fica fora do menu)", () => {
  const keys = (text: string, kind: "expense" | "event" = "expense") => {
    const r = parseFieldSelection(text, kind);
    return r.ok ? r.keys : null;
  };
  assert.deepEqual(keys("um e dois"), ["amount", "description"]);
  assert.deepEqual(keys("uma"), ["amount"]);
  assert.deepEqual(keys("cinco"), ["payment_method"]);
  assert.equal(keys("seis"), null, "o menu de gasto so tem 5 campos");
  assert.equal(keys("dez"), null);
  assert.equal(keys("onze"), null);
});

test("replyShape (aviso de expiracao): 'Um.' e 'dois' valem como resposta, como a previa ativa", () => {
  for (const text of ["Um.", "um", "dois", "três", "1", "sim", "opção dois", "nove"]) assert.equal(replyShape(text), "reply", text);
  assert.equal(replyShape("desfaz isso"), "undo");
  for (const text of ["dez", "um pouco", "dois dias", "bom dia"]) assert.equal(replyShape(text), null, text);
});

// RN09: nenhum ciclo de importacao entre os modulos de resposta (le o JS compilado)
test("sem ciclo de importacao entre confirmation/, targetChoice/ e fieldMenu/", () => {
  const root = path.resolve(__dirname, "../../src");
  const importsOf = (file: string): string[] => {
    const code = fs.readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of code.matchAll(/require\("(\.[^"]+)"\)/g)) {
      const resolved = path.resolve(path.dirname(file), m[1]);
      for (const candidate of [resolved + ".js", path.join(resolved, "index.js")]) {
        if (fs.existsSync(candidate)) {
          out.push(candidate);
          break;
        }
      }
    }
    return out;
  };
  const entries = ["confirmation/normalize.js", "confirmation/numbers.js", "confirmation/classify.js", "targetChoice/reply.js", "fieldMenu/select.js", "pending/expiredNotice.js", "confirmation/deletePreview.js", "text/search.js"].map((f) => path.join(root, f));
  const state = new Map<string, "visiting" | "done">();
  const visit = (file: string, trail: string[]) => {
    if (state.get(file) === "done") return;
    assert.notEqual(state.get(file), "visiting", `ciclo de importacao: ${[...trail, file].map((f) => path.relative(root, f)).join(" -> ")}`);
    state.set(file, "visiting");
    for (const dep of importsOf(file)) visit(dep, [...trail, file]);
    state.set(file, "done");
  };
  for (const entry of entries) visit(entry, []);
  // os modulos de base nao importam o classificador nem as telas que dependem deles
  for (const base of ["confirmation/normalize.js", "confirmation/numbers.js", "text/search.js"]) {
    const deps = importsOf(path.join(root, base)).map((f) => path.relative(root, f).replace(/\\/g, "/"));
    for (const dep of deps) assert.ok(!/classify|targetChoice|fieldMenu|expiredNotice/.test(dep), `${base} importa ${dep}`);
  }
});
