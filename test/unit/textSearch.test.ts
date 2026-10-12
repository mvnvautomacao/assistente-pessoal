import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByQuery, matchesQuery, MAX_SEARCH_RESULTS, normalizeSearch, SEARCH_SCAN_LIMIT } from "../../src/text/search";

test("normalizeSearch: sem acento, minusculas, pontuacao e simbolos viram espaco, espacos colapsados (RN01)", () => {
  assert.equal(normalizeSearch("Remédio da Pressão"), "remedio da pressao");
  assert.equal(normalizeSearch("  REMÉDIO,   da pressão. "), "remedio da pressao");
  assert.equal(normalizeSearch("Ação — coração; ñandú"), "acao coracao nandu");
  assert.equal(normalizeSearch("50%"), "50");
  assert.equal(normalizeSearch("a_b"), "a b");
  assert.equal(normalizeSearch("reuniao com  cliente"), "reuniao com cliente", "NBSP");
  assert.equal(normalizeSearch("🎉 Festa 🎉"), "festa", "emoji");
  assert.equal(normalizeSearch("2026"), "2026");
  assert.equal(normalizeSearch(""), "");
  assert.equal(normalizeSearch(null), "");
  assert.equal(normalizeSearch(undefined), "");
  assert.equal(normalizeSearch("%%__"), "");
});

test("matchesQuery: acento e caixa nao importam, nos dois sentidos", () => {
  assert.equal(matchesQuery("Remédio da pressão", "remedio"), true);
  assert.equal(matchesQuery("Consulta médica", "CONSULTA MÉDICA"), true);
  assert.equal(matchesQuery("consulta medica", "médica"), true, "titulo sem acento, consulta com acento");
  assert.equal(matchesQuery("Remédio da pressão", "REMÉDIO"), true);
  assert.equal(matchesQuery("Remédio da pressão", "vitamina"), false);
});

test("matchesQuery: todas as palavras, em qualquer ordem, como pedaco de palavra", () => {
  assert.equal(matchesQuery("Reunião com o cliente X", "reuniao cliente"), true);
  assert.equal(matchesQuery("Reunião com o cliente X", "cliente reuniao"), true, "ordem diferente");
  assert.equal(matchesQuery("Reunião com o cliente X", "reuniao fornecedor"), false, "falta uma palavra");
  assert.equal(matchesQuery("Remédio da pressão", "rem"), true, "prefixo e aceito");
  assert.equal(matchesQuery("Remédio da pressão", "ressao"), true, "pedaco de palavra");
  assert.equal(matchesQuery("Consulta", "remedio, da pressao."), false);
  assert.equal(matchesQuery("Remédio da pressão", "remédio, da pressão."), true, "pontuacao na consulta");
  assert.equal(matchesQuery("Evento 2026", "2026"), true, "so numeros");
});

test("matchesQuery: artigos e preposicoes da consulta sao ignorados, a menos que sejam as unicas palavras", () => {
  assert.equal(matchesQuery("Remédio da pressão", "o remédio"), true);
  assert.equal(matchesQuery("Remédio da pressão", "do remedio da pressao"), true);
  assert.equal(matchesQuery("Remédio", "a remédio"), true);
  assert.equal(matchesQuery("Dentista", "o"), false, "'o' sozinho e usado como esta (nao ha 'o' em dentista)");
  assert.equal(matchesQuery("Compro leite", "o"), true, "'o' sozinho e usado como esta");
  assert.equal(matchesQuery("Remédio da pressão", "da"), true, "so artigos: usados como estao");
  assert.equal(matchesQuery("Remédio da pressão", "do"), false);
});

test("matchesQuery: % e _ nunca sao curingas", () => {
  assert.equal(matchesQuery("Reunião", "%"), false, "'%' sozinho nao casa com tudo");
  assert.equal(matchesQuery("Desconto 50% off", "%"), true, "'%' sozinho compara o texto literal");
  assert.equal(matchesQuery("Almoço", "a_m_o"), true, "'_' separa palavras (a, m, o), nao e um caractere qualquer");
  assert.equal(matchesQuery("Almoço", "x_z"), false);
  assert.equal(matchesQuery("Reunião", "re%"), true, "'re%' = a palavra 're'");
  assert.equal(matchesQuery("Compras", "50%"), false);
  assert.equal(matchesQuery("Promo 50% hoje", "50%"), true);
  assert.equal(matchesQuery("Qualquer coisa", "_"), false);
});

test("matchesQuery: consulta vazia = sem filtro; texto vazio ou nulo nao quebra", () => {
  for (const q of ["", "   ", " ", null, undefined]) assert.equal(matchesQuery("Qualquer", q), true, String(q));
  for (const text of ["", null, undefined]) {
    assert.equal(matchesQuery(text, "algo"), false, String(text));
    assert.equal(matchesQuery(text, ""), true, `${text} sem filtro`);
  }
});

test("filterByQuery: preserva a ordem, limite vale DEPOIS do filtro", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, text: i % 2 === 0 ? `Remédio ${i}` : `Outro ${i}` }));
  const found = filterByQuery(rows, (r) => r.text, "remedio", 5);
  assert.deepEqual(found.map((r) => r.id), [0, 2, 4, 6, 8]);
  assert.equal(filterByQuery(rows, (r) => r.text, "remedio", MAX_SEARCH_RESULTS).length, 10);
  assert.equal(filterByQuery(rows, (r) => r.text, "", 100).length, 30, "sem filtro");
  assert.deepEqual(filterByQuery(rows, (r) => r.text, "nao existe", 10), []);
  assert.deepEqual(filterByQuery([] as { text: string }[], (r) => r.text, "x", 10), []);
});

test("filterByQuery: varre no maximo SEARCH_SCAN_LIMIT linhas", () => {
  assert.equal(SEARCH_SCAN_LIMIT, 500);
  const rows = Array.from({ length: SEARCH_SCAN_LIMIT + 50 }, (_, i) => ({ id: i, text: i >= SEARCH_SCAN_LIMIT ? "alvo" : "outro" }));
  assert.deepEqual(filterByQuery(rows, (r) => r.text, "alvo", 10), [], "o alvo esta alem do teto de varredura");
  rows[SEARCH_SCAN_LIMIT - 1].text = "alvo";
  assert.deepEqual(filterByQuery(rows, (r) => r.text, "alvo", 10).map((r) => r.id), [SEARCH_SCAN_LIMIT - 1]);
});
