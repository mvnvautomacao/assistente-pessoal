import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminTestServer, startDashboardTestServer } from "../helpers/app";
import { logActivity, getRecentActivity, getRecentBlockedAttempts } from "../../src/activity/service";
import { allowNumber, isNumberAllowed } from "../../src/access/allowlist";
import { getDashboardAccount, upsertDashboardPassword } from "../../src/dashboard/accounts";
import { hashPassword } from "../../src/auth/password";

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
