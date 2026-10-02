import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminTestServer, startDashboardTestServer } from "../helpers/app";
import { logActivity, getRecentActivity, getRecentBlockedAttempts } from "../../src/activity/service";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { getDashboardAccount, upsertDashboardPassword } from "../../src/dashboard/accounts";
import { hashPassword } from "../../src/auth/password";
import { getClientBilling, getPaidMonthsForClient } from "../../src/billing/service";
import { getNoExpenseReminderDays, setNoExpenseReminderDays } from "../../src/expenses/service";

async function withServer(fn: (baseUrl: string, authHeaders: () => Record<string, string>) => Promise<void>) {
  const server = await startAdminTestServer();
  try {
    await fn(server.baseUrl, server.authHeaders!);
  } finally {
    await server.close();
  }
}

// Achado da auditoria: atividade recente e tentativas bloqueadas sempre
// mostravam os ultimos 50, sem paginacao. Cada teste gera entradas com um
// marcador UNICO e proprio -- os testes desse arquivo compartilham o mesmo
// banco (cada arquivo de teste roda isolado num processo/DB proprio, mas os
// testes DENTRO do arquivo acumulam estado entre si), entao a asserção conta
// com as entradas novas sendo sempre as mais recentes (ordem DESC por id),
// nunca com uma posicao absoluta que dependeria do que rodou antes.
test("admin: atividade recente pagina em paginas de 10, mostrando itens diferentes em cada pagina", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const AP1 = "551100095001";
    // 25 entradas novas: garante que as 20 mais recentes sao TODAS minhas,
    // independente de quanta atividade ja existia antes nesse processo.
    for (let i = 0; i < 25; i++) logActivity(AP1, "expense", `marca-paginacao-${i}`);

    const page1 = await (await fetch(`${baseUrl}/admin?activity_page=1&activity_per_page=10`, { headers: authHeaders() })).text();
    for (let i = 24; i >= 15; i--) assert.ok(page1.includes(`marca-paginacao-${i}`), `pagina 1 devia ter marca-paginacao-${i}`);
    for (let i = 14; i >= 0; i--) assert.ok(!page1.includes(`marca-paginacao-${i}<`), `pagina 1 NAO devia ter marca-paginacao-${i}`);

    const page2 = await (await fetch(`${baseUrl}/admin?activity_page=2&activity_per_page=10`, { headers: authHeaders() })).text();
    for (let i = 14; i >= 5; i--) assert.ok(page2.includes(`marca-paginacao-${i}`), `pagina 2 devia ter marca-paginacao-${i}`);
    for (let i = 24; i >= 15; i--) assert.ok(!page2.includes(`marca-paginacao-${i}<`), `pagina 2 NAO devia ter marca-paginacao-${i}`);
  });
});

test("admin: paginar a lista de bloqueados nao reseta a pagina da atividade (secoes independentes)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const AP2 = "551100095002";
    for (let i = 0; i < 15; i++) logActivity(AP2, "expense", `marca-independente-${i}`);
    for (let i = 0; i < 15; i++) logActivity(`55110009500${i}bloq`, "blocked", `marca-bloqueado-${i}`);

    // "atividade" mistura TODOS os tipos (inclusive "blocked"), entao a
    // posicao exata de "marca-independente" na pagina 2 depende de quantos
    // "marca-bloqueado" (tambem type=activity) foram logados depois -- em vez
    // de adivinhar a posicao, calcula direto pelo mesmo criterio que o admin
    // usa (500 mais recentes, fatiado de 10 em 10) e confirma que a pagina 2
    // bate com esse calculo.
    const expectedActivityPage2 = getRecentActivity(500).slice(10, 20);
    const expectedBlockedPage2 = getRecentBlockedAttempts(500).slice(10, 20);

    const html = await (
      await fetch(`${baseUrl}/admin?activity_page=2&activity_per_page=10&blocked_page=2&blocked_per_page=10`, { headers: authHeaders() })
    ).text();

    for (const item of expectedActivityPage2) assert.ok(html.includes(item.summary), `atividade pagina 2 devia ter "${item.summary}"`);
    for (const item of expectedBlockedPage2) assert.ok(html.includes(item.summary), `bloqueados pagina 2 devia ter "${item.summary}"`);
  });
});

test("admin: revogar acesso ao painel apaga a conta, derruba sessao ativa, mas nao mexe na allowlist do bot", async () => {
  const PHONE = "551100095099";
  allowNumber(PHONE);
  upsertDashboardPassword(PHONE, await hashPassword("Test1234"));
  assert.ok(getDashboardAccount(PHONE));

  const dashboardServer = await startDashboardTestServer();
  const adminServer = await startAdminTestServer();
  try {
    const dashCookie = dashboardServer.authHeaders(PHONE).Cookie;
    const beforeRevoke = await fetch(`${dashboardServer.baseUrl}/dashboard`, { headers: { Cookie: dashCookie } });
    assert.ok(!(await beforeRevoke.text()).includes("Entre com o número de WhatsApp"));

    await fetch(`${adminServer.baseUrl}/admin/dashboard-accounts/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...adminServer.authHeaders!() },
      body: new URLSearchParams({ phone_number: PHONE }),
    });

    assert.equal(getDashboardAccount(PHONE), null);
    assert.ok(isNumberAllowed(PHONE)); // continua podendo falar com o bot

    const afterRevoke = await fetch(`${dashboardServer.baseUrl}/dashboard`, { headers: { Cookie: dashCookie } });
    assert.ok((await afterRevoke.text()).includes("Entre com o número de WhatsApp")); // sessao antiga nao serve mais
  } finally {
    await dashboardServer.close();
    await adminServer.close();
  }
});

test("admin: definir mensalidade/vencimento de um cliente e depois marcar pagamento mensal", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const PHONE = "551100095100";
    allowNumber(PHONE);

    await fetch(`${baseUrl}/admin/clients/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, monthly_fee: "49.90", next_due_date: "2020-01-01" }),
    });

    let billing = getClientBilling(PHONE);
    assert.equal(billing?.monthly_fee, 49.9);
    assert.equal(billing?.next_due_date, "2020-01-01");
    assert.equal(billing?.last_payment_date, null);

    const pageBeforePaid = await (await fetch(`${baseUrl}/admin`, { headers: authHeaders() })).text();
    assert.ok(pageBeforePaid.includes("Atrasado"), "vencimento no passado devia mostrar 'Atrasado'");

    await fetch(`${baseUrl}/admin/clients/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, plan: "mensal" }),
    });

    billing = getClientBilling(PHONE);
    assert.equal(billing?.monthly_fee, 19.9); // pagamento mensal sempre usa o preco fixo, sobrescreve o valor antigo
    assert.equal(billing?.plan, "mensal");
    assert.ok(billing?.last_payment_date);
    assert.notEqual(billing?.next_due_date, "2020-01-01"); // vencimento avancou

    const pageAfterPaid = await (await fetch(`${baseUrl}/admin`, { headers: authHeaders() })).text();
    assert.ok(pageAfterPaid.includes("Em dia"), "depois de marcar pago devia mostrar 'Em dia'");
    assert.ok(pageAfterPaid.includes("1 mês(es) pago(s)"), "devia mostrar 1 mes pago no historico");
  });
});

test("admin: pagamento anual cobre 12 competencias no historico de meses pagos", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const PHONE = "551100095103";
    allowNumber(PHONE);

    await fetch(`${baseUrl}/admin/clients/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, plan: "anual" }),
    });

    const billing = getClientBilling(PHONE);
    assert.equal(billing?.monthly_fee, 179.9);
    assert.equal(billing?.plan, "anual");

    const months = getPaidMonthsForClient(PHONE);
    assert.equal(months.length, 12);

    const page = await (await fetch(`${baseUrl}/admin`, { headers: authHeaders() })).text();
    assert.ok(page.includes("12 mês(es) pago(s)"));
  });
});

test("admin: mark-paid sem plano valido nao grava nada (evita registrar cobranca ambigua)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const PHONE = "551100095104";
    allowNumber(PHONE);

    await fetch(`${baseUrl}/admin/clients/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, plan: "trimestral" }),
    });

    assert.equal(getClientBilling(PHONE), null);
    assert.equal(getPaidMonthsForClient(PHONE).length, 0);
  });
});

test("admin: valor de mensalidade invalido (<=0 ou nao numerico) e data mal formada viram null, nao quebram a rota", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const PHONE = "551100095101";
    allowNumber(PHONE);

    await fetch(`${baseUrl}/admin/clients/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, monthly_fee: "-5", next_due_date: "31/12/2026" }),
    });

    const billing = getClientBilling(PHONE);
    assert.equal(billing?.monthly_fee, null);
    assert.equal(billing?.next_due_date, null);
  });
});

test("admin: revogar acesso de um cliente com cobranca configurada tira ele da allowlist (bot para de responder)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const PHONE = "551100095102";
    allowNumber(PHONE);
    await fetch(`${baseUrl}/admin/clients/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE, monthly_fee: "30", next_due_date: "2026-12-01" }),
    });
    assert.ok(isNumberAllowed(PHONE));

    await fetch(`${baseUrl}/admin/allowlist/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams({ from_number: PHONE }),
    });

    assert.ok(!isNumberAllowed(PHONE));
  });
});

// Pedido do usuario: o aviso de gasto pendente ("nao registrou nada hoje?")
// vinha todo dia; agora o ADMIN escolhe em quais dias da semana ele roda,
// pra todo mundo (nao e por numero/cliente). Padrao: segunda, quarta, sexta.
test("admin: pagina mostra segunda/quarta/sexta marcados por padrao, e salvar muda a configuracao global", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    setNoExpenseReminderDays([1, 3, 5]); // garante o padrao, independente de testes anteriores

    const page = await (await fetch(`${baseUrl}/admin`, { headers: authHeaders() })).text();
    assert.match(page, /<input type="checkbox" name="days" value="1" checked>\s*Segunda/);
    assert.match(page, /<input type="checkbox" name="days" value="3" checked>\s*Quarta/);
    assert.match(page, /<input type="checkbox" name="days" value="5" checked>\s*Sexta/);
    assert.doesNotMatch(page, /<input type="checkbox" name="days" value="0" checked>/); // domingo nao marcado

    await fetch(`${baseUrl}/admin/no-expense-reminder-days`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams([["days", "2"], ["days", "4"]]), // so terca e quinta
    });
    assert.deepEqual(getNoExpenseReminderDays(), [2, 4]);

    const updatedPage = await (await fetch(`${baseUrl}/admin`, { headers: authHeaders() })).text();
    assert.match(updatedPage, /<input type="checkbox" name="days" value="2" checked>\s*Terça/);
    assert.doesNotMatch(updatedPage, /<input type="checkbox" name="days" value="1" checked>/); // segunda desmarcou

    setNoExpenseReminderDays([1, 3, 5]); // devolve ao padrao, pra nao vazar pra outros testes
  });
});

test("admin: desmarcar todos os dias salva lista vazia (suspende o aviso pra todo mundo)", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    setNoExpenseReminderDays([1, 3, 5]);
    await fetch(`${baseUrl}/admin/no-expense-reminder-days`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeaders() },
      body: new URLSearchParams(), // nenhum "days" -- nenhum checkbox marcado
    });
    assert.deepEqual(getNoExpenseReminderDays(), []);
    setNoExpenseReminderDays([1, 3, 5]); // devolve ao padrao
  });
});
