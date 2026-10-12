import { test } from "node:test";
import assert from "node:assert/strict";
import { DeleteFlow, deleteNotUnderstood, formatDeleteConfirmation, interpretDeleteReply } from "../../src/confirmation/deletePreview";

test("formatDeleteConfirmation: os 10 fluxos (opcoes 1 e 3, rotulos por fluxo)", () => {
  const cases: [DeleteFlow, string, string, string][] = [
    ["event", "🗑️ Cancelar este evento?", "1 🗑️ Cancelar o evento", "3 ↩️ Manter na agenda"],
    ["reminder", "🗑️ Apagar este lembrete?", "1 🗑️ Apagar", "3 ❌ Cancelar"],
    ["expense", "🗑️ Apagar este gasto?", "1 🗑️ Apagar", "3 ❌ Cancelar"],
    ["installment", "🗑️ Apagar TODAS as 3 parcelas?", "1 🗑️ Apagar todas", "3 ❌ Cancelar"],
    ["category", '🗑️ Apagar a categoria "Lazer"?', "1 🗑️ Apagar", "3 ❌ Cancelar"],
    ["budget", '🗑️ Remover o orçamento de "Lazer"?', "1 🗑️ Remover", "3 ❌ Cancelar"],
    ["recurring", "🛑 Parar de lançar este gasto fixo?", "1 🛑 Parar de lançar", "3 ❌ Cancelar"],
    ["bill_alert", '🛑 Parar o alerta de "Luz"?', "1 🛑 Parar de avisar", "3 ❌ Cancelar"],
    ["merge", '🔀 Juntar "A" em "B"?', "1 🔀 Juntar", "3 ❌ Cancelar"],
    ["bulk", '🔀 Mudar 2 gastos para "X"?', "1 ✅ Mudar", "3 ❌ Cancelar"],
  ];
  for (const [flow, title, one, three] of cases) {
    assert.equal(formatDeleteConfirmation({ flow, title }), `${title}\n\n${one}\n${three}`, flow);
    assert.equal(formatDeleteConfirmation({ flow, title, detail: "Item — R$ 38,00" }), `${title}\nItem — R$ 38,00\n\n${one}\n${three}`, flow);
  }
});

test("formatDeleteConfirmation: detalhe + avisos extras e a opcao 2 so quando pedida", () => {
  assert.equal(
    formatDeleteConfirmation({ flow: "category", title: '🗑️ Apagar a categoria "Lazer"?', notes: ["Os 12 gastos dela ficam sem categoria (não são apagados)."] }),
    '🗑️ Apagar a categoria "Lazer"?\nOs 12 gastos dela ficam sem categoria (não são apagados).\n\n1 🗑️ Apagar\n3 ❌ Cancelar'
  );
  assert.equal(
    formatDeleteConfirmation({ flow: "expense", title: "🗑️ Apagar este gasto?", detail: "Mercado — R$ 38,00 · 07/10 · Pix · Alimentação", offerOther: true }),
    "🗑️ Apagar este gasto?\nMercado — R$ 38,00 · 07/10 · Pix · Alimentação\n\n1 🗑️ Apagar\n2 🔎 Não é esse, ver os últimos\n3 ❌ Cancelar"
  );
  // sem alvo explicito, tambem na compra parcelada
  assert.match(
    formatDeleteConfirmation({ flow: "installment", title: "t", detail: "d", offerOther: true }),
    /1 🗑️ Apagar todas\n2 🔎 Não é esse, ver os últimos\n3 ❌ Cancelar$/
  );
  // detalhe e avisos vazios nao deixam linha em branco sobrando
  assert.equal(formatDeleteConfirmation({ flow: "bulk", title: "t", notes: [] }), "t\n\n1 ✅ Mudar\n3 ❌ Cancelar");
});

test("deleteNotUnderstood: verbo do fluxo e variante com a opcao 2", () => {
  const verbs: [DeleteFlow, string][] = [
    ["event", "cancelar o evento"],
    ["reminder", "apagar"],
    ["expense", "apagar"],
    ["installment", "apagar"],
    ["category", "apagar"],
    ["budget", "remover"],
    ["recurring", "parar"],
    ["bill_alert", "parar"],
    ["merge", "juntar"],
    ["bulk", "mudar"],
  ];
  for (const [flow, verb] of verbs) {
    const expected = flow === "event" ? `Não entendi 🤔 Responde *1* pra ${verb} ou *3* pra manter.` : `Não entendi 🤔 Responde *1* pra ${verb} ou *3* pra cancelar.`;
    assert.equal(deleteNotUnderstood({ flow }), expected, flow);
  }
  assert.equal(
    deleteNotUnderstood({ flow: "expense", offerOther: true }),
    "Não entendi 🤔 Responde *1* pra apagar, *2* pra ver os últimos gastos ou *3* pra cancelar."
  );
});

test("interpretDeleteReply: so a mensagem INTEIRA confirma ou cancela (RN01)", () => {
  for (const text of ["1", " 1 ", "1.", "sim", "Sim!", "👍", "confirmo", "pode", "ok"]) {
    assert.equal(interpretDeleteReply(text, false), "confirm", `"${text}"`);
  }
  for (const text of ["3", "não", "Não.", "n", "cancelar", "cancela", "❌", "deixa pra lá"]) {
    assert.equal(interpretDeleteReply(text, false), "cancel", `"${text}"`);
  }
  // o defeito dos regex de prefixo: qualquer frase comecando por "pode"/"sim"/"nao" valia
  for (const text of ["pode ser amanhã", "sim, mas só o do dia 10", "não, é o outro", "sim mas espera", "nao sei", "talvez", "", "   ", "corrigir", "4"]) {
    assert.equal(interpretDeleteReply(text, false), "not_understood", `"${text}"`);
    assert.equal(interpretDeleteReply(text, true), "not_understood", `"${text}" (com opcao 2)`);
  }
});

test("interpretDeleteReply: opcao 2 so existe quando o fluxo a oferece; 'nao' continua cancelando", () => {
  assert.equal(interpretDeleteReply("2", false), "not_understood");
  assert.equal(interpretDeleteReply("não é esse", false), "not_understood");
  for (const text of ["2", " 2 ", "não é esse", "Não é esse!", "nao e essa", "outro", "Outro.", "ver os últimos"]) {
    assert.equal(interpretDeleteReply(text, true), "other", `"${text}"`);
  }
  // "nao" e "3" cancelam e NUNCA abrem a lista, mesmo com a opcao 2 disponivel
  for (const text of ["não", "3", "cancelar"]) assert.equal(interpretDeleteReply(text, true), "cancel", `"${text}"`);
  assert.equal(interpretDeleteReply("1", true), "confirm");
});
