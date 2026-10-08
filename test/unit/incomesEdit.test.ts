import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertIncome,
  findIncomeCandidates,
  getRecentIncomesList,
  listIncomesBetween,
  findRecentIncome,
} from "../../src/incomes/service";
import { setLastShownIncomes, getLastShownIncomes, clearLastShownIncomes } from "../../src/incomes/listCache";
import { setLastShownExpenses, getLastShownExpenses } from "../../src/expenses/listCache";
import { normalizeIncomeChanges, setPendingEditIncome, getPendingEditIncome, clearPendingEditIncome } from "../../src/incomes/pendingEditIncome";
import { setPendingDeleteIncome, getPendingDeleteIncome, clearPendingDeleteIncome } from "../../src/incomes/pendingDeleteIncome";
import { buildIncomeEditItem, incomeHeader } from "../../src/incomes/editItem";
import {
  INCOME_DELETE_NOT_UNDERSTOOD,
  MAX_INCOME_LIST,
  formatIncomeDeletePrompt,
  formatIncomeEditPreview,
  formatIncomeEditSuccess,
  formatIncomeList,
  incomeChangedText,
  incomeCorrectionOptions,
  incomeDeletedText,
  incomeLine,
} from "../../src/confirmation/incomePreview";
import { parseFieldSelection } from "../../src/fieldMenu/select";
import { FIELD_REGISTRY } from "../../src/fieldMenu/registry";

const TODAY = "2026-10-08";

test("findIncomeCandidates: 0, 1 e varios candidatos, mais recente primeiro, so desse numero", () => {
  const N = "551100140001";
  insertIncome({ fromNumber: N, amount: 3000, description: "Salário", date: "2026-10-01" });
  insertIncome({ fromNumber: N, amount: 400, description: "Salário extra", date: "2026-10-02" });
  insertIncome({ fromNumber: N, amount: 800, description: "Freela logo", date: "2026-10-03" });
  insertIncome({ fromNumber: "551100140002", amount: 1, description: "Salário alheio", date: "2026-10-03" });

  assert.deepEqual(findIncomeCandidates(N, "salario").map((i) => i.description), ["Salário extra", "Salário"]);
  assert.deepEqual(findIncomeCandidates(N, "FREELA").map((i) => i.description), ["Freela logo"]);
  assert.deepEqual(findIncomeCandidates(N, "nada"), []);
  assert.deepEqual(findIncomeCandidates(N, "   "), []);
  assert.equal(findIncomeCandidates(N, "salario", 1).length, 1);
  assert.equal(findRecentIncome(N, "freela")?.description, "Freela logo");
});

test("findIncomeCandidates: janela das 20 entradas mais recentes", () => {
  const N = "551100140003";
  insertIncome({ fromNumber: N, amount: 1, description: "Muito antiga", date: "2026-01-01" });
  for (let i = 0; i < 20; i++) insertIncome({ fromNumber: N, amount: 1, description: `Recente ${i}`, date: "2026-10-01" });
  assert.deepEqual(findIncomeCandidates(N, "antiga"), []);
  assert.equal(findIncomeCandidates(N, "recente").length, 20);
});

test("getRecentIncomesList e listIncomesBetween: ordem por data e id, limites do periodo", () => {
  const N = "551100140004";
  insertIncome({ fromNumber: N, amount: 1, description: "Setembro", date: "2026-09-30" });
  insertIncome({ fromNumber: N, amount: 2, description: "Outubro 1", date: "2026-10-01" });
  insertIncome({ fromNumber: N, amount: 3, description: "Outubro 2", date: "2026-10-01" });
  insertIncome({ fromNumber: N, amount: 4, description: "Outubro 15", date: "2026-10-15" });
  assert.deepEqual(getRecentIncomesList(N, 3).map((i) => i.description), ["Outubro 15", "Outubro 2", "Outubro 1"]);
  assert.deepEqual(listIncomesBetween(N, "2026-10-01", "2026-11-01").map((i) => i.description), ["Outubro 15", "Outubro 2", "Outubro 1"]);
  assert.deepEqual(listIncomesBetween(N, "2026-09-01", "2026-10-01").map((i) => i.description), ["Setembro"]);
  assert.deepEqual(listIncomesBetween("551100140099", "2026-01-01", "2027-01-01"), []);
});

test("cache da lista de entradas: TTL de 10 min e uma lista invalida a outra", () => {
  const N = "551100140005";
  setLastShownIncomes(N, [1, 2], "esse mês");
  assert.deepEqual(getLastShownIncomes(N), [1, 2]);
  setLastShownExpenses(N, [9]);
  assert.equal(getLastShownIncomes(N), null); // gastos invalidaram
  setLastShownIncomes(N, [3]);
  assert.equal(getLastShownExpenses(N), null); // entradas invalidaram
  assert.deepEqual(getLastShownIncomes(N), [3]);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 9 * 60 * 1000;
    assert.ok(getLastShownIncomes(N));
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(getLastShownIncomes(N), null);
  } finally {
    Date.now = realNow;
  }
  setLastShownIncomes(N, [1]);
  clearLastShownIncomes(N);
  assert.equal(getLastShownIncomes(N), null);
});

test("normalizeIncomeChanges: so valor/descricao/data, ultimo valor vence, legado field/value", () => {
  assert.deepEqual(normalizeIncomeChanges({ field: "amount", value: "3500" }), [{ field: "amount", value: "3500" }]);
  assert.deepEqual(
    normalizeIncomeChanges({
      changes: [
        { field: "amount", value: "1" },
        { field: "category", value: "Lazer" },
        { field: "payment_method", value: "Pix" },
        { field: "description", value: "Freela" },
        { field: "amount", value: "2" },
      ],
    }),
    [
      { field: "amount", value: "2" },
      { field: "description", value: "Freela" },
    ]
  );
  assert.deepEqual(normalizeIncomeChanges({}), []);
});

test("pendencias de edicao e exclusao de entrada: por numero, TTL de 10 min", () => {
  const N = "551100140006";
  const params = { amount: 1, description: "x", date: TODAY };
  setPendingEditIncome(N, { incomeId: 1, description: "x", headerText: "h", previous: params, proposed: params, rawChanges: [], views: [], awaitingCorrection: false, correctionStage: "pick", correctionTarget: null });
  setPendingDeleteIncome(N, { incomeId: 1, snapshot: params });
  assert.ok(getPendingEditIncome(N));
  assert.ok(getPendingDeleteIncome(N));
  assert.equal(getPendingEditIncome("551100140007"), null);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(getPendingEditIncome(N), null);
    assert.equal(getPendingDeleteIncome(N), null);
  } finally {
    Date.now = realNow;
  }
  setPendingEditIncome(N, { incomeId: 1, description: "x", headerText: "h", previous: params, proposed: params, rawChanges: [], views: [], awaitingCorrection: false, correctionStage: "pick", correctionTarget: null });
  clearPendingEditIncome(N);
  clearPendingDeleteIncome(N);
  assert.equal(getPendingEditIncome(N), null);
});

test("buildIncomeEditItem: prévia com antes -> depois, omite o que nao muda e recusa invalido", async () => {
  const previous = { amount: 3000, description: "Salário", date: "2026-09-05" };
  const ok = await buildIncomeEditItem(
    previous,
    [
      { field: "amount", value: "3.500,50" },
      { field: "date", value: "ontem" },
      { field: "description", value: "  Salário   novo " },
    ],
    TODAY
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.proposed, { amount: 3500.5, description: "Salário novo", date: "2026-10-07" });
    assert.deepEqual(
      ok.views.map((v) => `${v.label}: ${v.from} → ${v.to}`),
      ["Valor: R$ 3.000,00 → R$ 3.500,50", "Data: 05/09 → 07/10", "Descrição: Salário → Salário novo"]
    );
  }

  const same = await buildIncomeEditItem(previous, [{ field: "amount", value: "3000" }, { field: "description", value: "Salário" }, { field: "date", value: "05/09/2026" }], TODAY);
  assert.equal(same.ok && same.views.length, 0);

  for (const [change, expected] of [
    [{ field: "amount", value: "2000000" }, /muito alto/],
    [{ field: "amount", value: "abc" }, /Não entendi o valor/],
    [{ field: "amount", value: "0" }, /maior que R\$ 0,00/],
    [{ field: "date", value: "31/02" }, /Essa data não parece certa/],
    [{ field: "date", value: "01/01/2010" }, /Essa data não parece certa/],
    [{ field: "description", value: "   " }, /Não recebi nada/],
    [{ field: "description", value: "x".repeat(101) }, /muito longo/],
  ] as const) {
    const r = await buildIncomeEditItem(previous, [change], TODAY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, expected);
  }
  assert.equal(incomeHeader(previous), "Salário — R$ 3.000,00 · 05/09");
});

test("formatadores de entrada: lista, previa, sucesso, exclusao e avisos", () => {
  const items = [
    { description: "Salário", amount: 3000, date: "2026-09-05" },
    { description: "Freela logo", amount: 800, date: "2026-09-12" },
  ];
  assert.equal(incomeLine(items[0]), "Salário — R$ 3.000,00 · 05/09");
  assert.equal(
    formatIncomeList({ label: "setembro/2026", items, total: 3800, totalCount: 2, dashboardUrl: "https://x/dashboard" }),
    '💵 Entradas — setembro/2026\n\n1. Salário — R$ 3.000,00 · 05/09\n2. Freela logo — R$ 800,00 · 12/09\n\n💰 Total: R$ 3.800,00\n\nPra editar ou apagar, é só dizer, ex: "muda o valor do 2 pra 850" ou "apaga o 2".'
  );
  assert.match(
    formatIncomeList({ label: "x", items, total: 9999, totalCount: 25, dashboardUrl: "https://x/dashboard" }),
    /\n\nMostrando as 2 mais recentes\. Veja todas no painel: https:\/\/x\/dashboard\n\n💰 Total: R\$ 9\.999,00/
  );
  assert.equal(MAX_INCOME_LIST, 20);

  const views = [{ field: "amount" as const, label: "Valor", from: "R$ 3.000,00", to: "R$ 3.500,00" }];
  assert.equal(
    formatIncomeEditPreview("Salário — R$ 3.000,00 · 05/09", views),
    "✏️ Salário — R$ 3.000,00 · 05/09\nValor: R$ 3.000,00 → R$ 3.500,00\n\n1 ✅ Confirmar\n2 ✏️ Corrigir\n3 ❌ Cancelar"
  );
  assert.equal(formatIncomeEditSuccess("Salário", views), '✏️ Entrada "Salário" atualizada: valor R$ 3.500,00.');
  assert.equal(
    formatIncomeEditSuccess("Salário", [
      { field: "description", label: "Descrição", from: "a", to: "b" },
      { field: "date", label: "Data", from: "c", to: "05/10" },
    ]),
    '✏️ Entrada "Salário" atualizada: descrição b; data 05/10.'
  );
  assert.deepEqual(incomeCorrectionOptions(views).map((o) => [o.itemIndex, o.field, o.label]), [[0, "amount", "Valor"]]);
  assert.equal(formatIncomeDeletePrompt("Salário — R$ 3.000,00 · 05/09"), "🗑️ Vou apagar a entrada: Salário — R$ 3.000,00 · 05/09\n\n1 ✅ Apagar\n3 ❌ Cancelar");
  assert.equal(INCOME_DELETE_NOT_UNDERSTOOD, "Não entendi 🤔 Responde *1* pra apagar ou *3* pra cancelar.");
  assert.equal(incomeDeletedText("Salário"), '🗑️ Entrada "Salário" apagada.');
  assert.equal(incomeChangedText("Salário", 3200), 'A entrada "Salário" mudou enquanto a gente conversava (agora está R$ 3.200,00). Me pede de novo.');
});

test("menu guiado de entrada: campos e selecao (apelidos descricao/nome/origem)", () => {
  assert.deepEqual(FIELD_REGISTRY.income.map((f) => f.label), ["Valor", "Descrição", "Data"]);
  const keys = (text: string) => {
    const r = parseFieldSelection(text, "income");
    return r.ok ? r.keys : null;
  };
  assert.deepEqual(keys("1 e 3"), ["amount", "date"]);
  assert.deepEqual(keys("descricao"), ["description"]);
  assert.deepEqual(keys("origem"), ["description"]);
  assert.deepEqual(keys("nome e data"), ["description", "date"]);
  assert.equal(keys("4"), null);
});
