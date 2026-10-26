// Card 24: Nivel A (regra tolerante), opcoes das perguntas abertas e leitura da resposta "Entendi que foi *N*. Confirma?". Tudo puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretOpenReply, interpretReplyRules, RULES_MAX_WORDS } from "../../src/confirmation/interpretReply";
import { billReplyQuestion, deleteReplyQuestion, optionByNumber, previewReplyQuestion, recurrenceReplyQuestion } from "../../src/confirmation/replyOptions";
import { buildReplyConfirmMessage, heardLine, readReplyConfirmation, truncateText } from "../../src/confirmation/replyConfirm";

const bill = billReplyQuestion("Conta de luz", "day_of_month", false);
const preview = previewReplyQuestion("Almoço");
const del = deleteReplyQuestion({ flow: "expense" });
const delEvent = deleteReplyQuestion({ flow: "event" });
const delOther = deleteReplyQuestion({ flow: "expense", offerOther: true });

const pick = (text: string, question = bill) => interpretReplyRules(text, question)?.number ?? null;

test("aviso de conta: frases naturais de 'pago' viram a opcao 1; 'ainda nao' e adiar viram 2; pular vira 3", () => {
  for (const phrase of ["Já paguei a conta hoje.", "Eu já paguei", "paguei já", "quitei a conta", "ja resolvi", "tá pago já, pode ficar tranquilo", "paguei a luz agora"]) {
    assert.equal(pick(phrase), 1, phrase);
  }
  for (const phrase of ["ainda não deu pra pagar", "me lembra amanhã por favor", "depois eu vejo", "mais tarde"]) {
    assert.equal(pick(phrase), 2, phrase);
  }
  for (const phrase of ["pula esse mês", "vou pular", "esse mês não"]) assert.equal(pick(phrase), phrase === "vou pular" ? null : 3, phrase);
});

test("conflitos e ressalvas nunca viram sugestao: negacao, condicao, duvida, outro item, pagamento parcial, digitos e frase longa", () => {
  for (const phrase of [
    "não, já paguei",
    "sim, mas só amanhã",
    "paguei metade",
    "acho que paguei",
    "talvez eu tenha pago",
    "paguei a outra",
    "paguei 50 reais",
    "paguei dia 10",
    "quase paguei",
    "eu vou pagar",
    "espera que eu já pago",
    "paguei errado",
    "",
    "bla",
  ]) {
    assert.equal(pick(phrase), null, phrase);
  }
  assert.equal(pick("eu já paguei a conta de luz que vence hoje ontem de manhã cedo"), null, `mais de ${RULES_MAX_WORDS} palavras`);
});

test("duas intencoes na mesma frase (ambigua) nao viram sugestao", () => {
  assert.equal(pick("já paguei, me lembra amanhã"), null);
  assert.equal(pick("já paguei e pula esse mês"), null);
  assert.equal(interpretReplyRules("cancela isso", preview), null, "'isso' (confirmar) e 'cancela' (cancelar) juntos");
});

test("previa 1/2/3: confirmar, corrigir e cancelar em linguagem natural; valor embutido nunca e resposta", () => {
  for (const phrase of ["isso mesmo, pode salvar", "pode confirmar", "perfeito", "salva aí", "exatamente isso", "manda ver"]) assert.equal(pick(phrase, preview), 1, phrase);
  for (const phrase of ["quero corrigir", "ajusta", "tá errado"]) assert.equal(pick(phrase, preview), 2, phrase);
  for (const phrase of ["deixa pra lá", "esquece", "desisto", "melhor não", "não quero mais", "cancela por favor"]) assert.equal(pick(phrase, preview), 3, phrase);
  for (const phrase of ["pode ser às 16h", "pode ser 30", "isso mesmo, 45"]) assert.equal(pick(phrase, preview), null, phrase);
  assert.equal(pick("quero corrigir", bill), null, "so as opcoes da pergunta aberta podem ser sugeridas");
});

test("apagar 1/3: 'pode apagar' confirma; 'acho que sim' e 'nao apaga' nao; no evento 'cancelar o evento' CONFIRMA e 'deixa' mantem", () => {
  assert.equal(pick("pode apagar", del), 1);
  assert.equal(pick("pode excluir esse", del), 1);
  assert.equal(pick("confirmo", del), 1);
  assert.equal(pick("acho que sim", del), null);
  assert.equal(pick("não apaga", del), null);
  assert.equal(pick("deixa quieto", del), 3);
  assert.equal(pick("cancela", del), 3, "fora do evento, cancelar e desistir");
  assert.equal(pick("pode cancelar o evento", delEvent), 1);
  assert.equal(pick("cancela o evento", delEvent), 1);
  assert.equal(pick("cancela", delEvent), null, "no evento 'cancela' sozinho e ambiguo");
  assert.equal(pick("melhor deixar", delEvent), 3);
  assert.equal(pick("pode apagar", delOther), 1);
  assert.equal(optionByNumber(delOther, 2)?.intent, "other");
});

test("perguntas do cadastro: so cancelar tem vocabulario do Nivel A; as outras opcoes ficam com a IA", () => {
  const choose = recurrenceReplyQuestion("choose_type");
  assert.equal(pick("quero lançar sozinho", choose), null);
  assert.equal(pick("esquece isso", choose), 3);
  assert.equal(pick("pode atualizar o existente", recurrenceReplyQuestion("duplicate")), null);
  assert.deepEqual(recurrenceReplyQuestion("this_month").options.map((o) => o.intent), ["launch_this_month", "next_month_only", "cancel"]);
});

test("opcoes: rotulos, destrutivas e assunto da fila", () => {
  assert.deepEqual(bill.options.map((o) => [o.number, o.intent, o.label, Boolean(o.destructive)]), [
    [1, "paid", "✅ Já paguei", false],
    [2, "snooze", "⏰ Ainda não, me lembra amanhã", false],
    [3, "skip", "⏭️ Não vou pagar este mês (pular)", true],
  ]);
  assert.equal(billReplyQuestion("Ração", "interval", true).options[0].label, "✅ Já resolvi");
  assert.equal(billReplyQuestion("Ração", "interval", true).subject, "Ração");
  assert.equal(bill.subject, undefined);
  assert.equal(del.options[0].destructive, true);
  assert.equal(del.options.length, 2);
  assert.equal(delOther.options.length, 3);
  assert.equal(delEvent.options[1].label, "↩️ Manter na agenda");
});

test("interpretOpenReply: Nivel A resolve; sem vocabulario devolve null", async () => {
  assert.deepEqual(await interpretOpenReply("5511", "já paguei a conta hoje", bill), { option: bill.options[0], level: "rules" });
  assert.equal(await interpretOpenReply("5511", "hmm sei la", bill), null);
});

test("mensagens: 'Entendi que foi *N*', 'Ouvi', assunto da fila e truncamento", () => {
  assert.equal(
    buildReplyConfirmMessage({ optionNumber: 1, optionLabel: "✅ Já paguei" }),
    "Entendi que foi *1 ✅ Já paguei*. Confirma?\n1 Sim, é isso\n2 Não, ver as opções"
  );
  assert.equal(
    buildReplyConfirmMessage({ optionNumber: 1, optionLabel: "✅ Já paguei", subject: "Luz", heard: "já paguei a conta hoje" }),
    '🎧 Ouvi: "já paguei a conta hoje"\nSobre *Luz*: Entendi que foi *1 ✅ Já paguei*. Confirma?\n1 Sim, é isso\n2 Não, ver as opções'
  );
  assert.equal(truncateText("  muito   espaço  ", 50), "muito espaço");
  assert.equal(truncateText("a".repeat(130), 120), `${"a".repeat(119)}…`);
  assert.equal(heardLine("a".repeat(130)), `🎧 Ouvi: "${"a".repeat(119)}…"`);
});

test("leitura da resposta a sugestao: 1/sim aplicam, 2/nao mostram as opcoes, o resto descarta a sugestao", () => {
  for (const yes of ["1", "sim", "Sim.", "um", "isso", "ok", "confirmo", "👍"]) assert.equal(readReplyConfirmation(yes), "yes", yes);
  for (const no of ["2", "não", "Não.", "dois", "nao e isso", "ver as opções", "❌"]) assert.equal(readReplyConfirmation(no), "no", no);
  for (const other of ["3", "cancelar", "gastei 50 no mercado", "talvez", "", "1 e 2", "4"]) assert.equal(readReplyConfirmation(other), "other", other);
});
