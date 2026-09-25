import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer, startAdminTestServer, startFullAppTestServer } from "../helpers/app";
import * as whatsappClient from "../../src/whatsapp/client";
import { allowNumber } from "../../src/access/allowlist";
import { upsertDashboardPassword } from "../../src/dashboard/accounts";
import { hashPassword } from "../../src/auth/password";
import { config } from "../../src/config";
import { resetLoginGuardForTests } from "../../src/auth/loginGuard";

function mockSendText(t: TestContext) {
  const sent: { to: string; text: string }[] = [];
  t.mock.method(whatsappClient, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  return sent;
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const raw = setCookie.find((c) => c.length > 0) ?? "";
  return raw.split(";")[0];
}

// mascara pede 11 digitos (DDD + celular, sem "55") -- "55" e prefixado no
// server antes de normalizar (mesma conta do formato canonico sem o "9" do
// meio, ver normalizeBrazilPhone). 61 + 999210999 = 11 digitos digitados;
// 55 + 61999210999 = 13 digitos -> normaliza pra 556199210999 (12 digitos).
const DDD_CELL = "61999210999";
const CANONICAL = "556199210999";

test("dashboard: pedir senha manda por WhatsApp (mockado), cria a conta, e respeita o limite de 1h", async (t) => {
  const sent = mockSendText(t);
  allowNumber(CANONICAL);
  const server = await startDashboardTestServer();
  try {
    await fetch(`${server.baseUrl}/dashboard/request-password`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DDD_CELL }),
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, CANONICAL);
    assert.match(sent[0].text, /senha de acesso/i);
    assert.ok(sent[0].text.includes("https://marcusvnv.com.br/dashboard")); // link do painel junto da senha

    // pedir de novo na hora: ja mandou nessa ultima hora, nao manda outra
    await fetch(`${server.baseUrl}/dashboard/request-password`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DDD_CELL }),
    });
    assert.equal(sent.length, 1);
  } finally {
    await server.close();
  }
});

test("dashboard: pedir senha pra numero nao autorizado nao manda nada (mas responde a mesma mensagem)", async (t) => {
  const sent = mockSendText(t);
  const server = await startDashboardTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/dashboard/request-password`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: "61988887777" }), // nunca autorizado
    });
    assert.equal(sent.length, 0);
    const html = await res.text();
    assert.match(html, /se esse número tiver acesso liberado/i);
  } finally {
    await server.close();
  }
});

test("dashboard: login com senha certa entra, com senha errada nao", async () => {
  allowNumber(CANONICAL);
  upsertDashboardPassword(CANONICAL, await hashPassword("Test1234"));
  const server = await startDashboardTestServer();
  try {
    const wrong = await fetch(`${server.baseUrl}/dashboard/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DDD_CELL, password: "senha-errada" }),
      redirect: "manual",
    });
    assert.equal(wrong.status, 401);

    const right = await fetch(`${server.baseUrl}/dashboard/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DDD_CELL, password: "Test1234" }),
      redirect: "manual",
    });
    assert.equal(right.status, 302);
    const cookie = extractSessionCookie(right);
    assert.ok(cookie.length > 0);

    const dashboard = await fetch(`${server.baseUrl}/dashboard`, { headers: { Cookie: cookie } });
    const html = await dashboard.text();
    assert.ok(!html.includes("Entre com o número de WhatsApp"));
  } finally {
    await server.close();
  }
});

// Achado da auditoria: o /admin ja tinha trava de forca bruta, o /dashboard
// nao tinha nenhuma -- cada tentativa roda um bcrypt.compare (mesmo pra
// numero sem conta, via DUMMY_HASH), entao um flood de tentativas erradas
// vira negacao de servico por CPU (Node e single-thread). resetLoginGuardForTests
// no inicio E no fim evita que o contador (por IP, compartilhado entre testes
// nesse mesmo processo) vaze pra outros testes desse arquivo.
test("dashboard: 5 senhas erradas seguidas trava o login por um tempo, mesmo com a senha certa depois", async () => {
  resetLoginGuardForTests();
  allowNumber(CANONICAL);
  upsertDashboardPassword(CANONICAL, await hashPassword("Test1234"));
  const server = await startDashboardTestServer();
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${server.baseUrl}/dashboard/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ phone: DDD_CELL, password: "senha-errada" }),
      });
      assert.equal(res.status, 401);
    }

    const lockedEvenWithRightPassword = await fetch(`${server.baseUrl}/dashboard/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DDD_CELL, password: "Test1234" }),
      redirect: "manual",
    });
    assert.equal(lockedEvenWithRightPassword.status, 429);
  } finally {
    resetLoginGuardForTests();
    await server.close();
  }
});

test("admin: login com credenciais certas entra, erradas nao", async () => {
  const server = await startAdminTestServer();
  try {
    const wrong = await fetch(`${server.baseUrl}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: config.admin.username, password: "senha-errada" }),
      redirect: "manual",
    });
    assert.equal(wrong.status, 401);

    const right = await fetch(`${server.baseUrl}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: config.admin.username, password: config.admin.password }),
      redirect: "manual",
    });
    assert.equal(right.status, 302);
    const cookie = extractSessionCookie(right);
    assert.ok(cookie.length > 0);

    const admin = await fetch(`${server.baseUrl}/admin`, { headers: { Cookie: cookie } });
    const html = await admin.text();
    assert.ok(html.includes("Atividade recente"));
  } finally {
    await server.close();
  }
});

test("admin: reset de senha ignora o limite de 1h que vale pro autoatendimento", async (t) => {
  const sent = mockSendText(t);
  const PHONE = "556199210998"; // canonico, numero dedicado desse teste
  const DIGITS = "61999210998"; // 11 digitos, sem "55"
  allowNumber(PHONE);

  const dashboardServer = await startDashboardTestServer();
  try {
    await fetch(`${dashboardServer.baseUrl}/dashboard/request-password`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ phone: DIGITS }),
    });
    assert.equal(sent.length, 1); // 1o envio, autoatendimento
  } finally {
    await dashboardServer.close();
  }

  const adminServer = await startAdminTestServer();
  try {
    const login = await fetch(`${adminServer.baseUrl}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: config.admin.username, password: config.admin.password }),
      redirect: "manual",
    });
    const cookie = extractSessionCookie(login);

    await fetch(`${adminServer.baseUrl}/admin/dashboard-accounts/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ phone_number: PHONE }),
    });
    // reset do admin manda de novo mesmo dentro da mesma hora do autoatendimento
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, PHONE);
  } finally {
    await adminServer.close();
  }
});

// Regressao: em producao, /dashboard sem sessao nenhuma mostrava a tela de
// LOGIN DO ADMIN em vez da tela de login do dashboard. Causa: adminRouter.use
// (fn) sem path aplicava a TODA rota que passasse por esse router (nao so
// /admin), e como adminRouter e montado antes de dashboardRouter em index.ts,
// ele barrava /dashboard antes mesmo do dashboardRouter rodar. So aparecia
// mascarado se o navegador ja tivesse uma sessao de admin valida de outro
// teste manual (por isso os testes com um router de cada vez nunca pegaram).
test("REGRESSAO: /dashboard sem sessao mostra o login do DASHBOARD, nao o do admin, mesmo com o adminRouter montado junto", async () => {
  const server = await startFullAppTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/dashboard`);
    const html = await res.text();
    assert.ok(html.includes("Entre com o número de WhatsApp"), "devia mostrar o login do dashboard");
    assert.ok(!html.includes('action="/admin/login"'), "nao pode mostrar o login do admin aqui");
  } finally {
    await server.close();
  }
});

// Regressao: em producao, o Coolify chamava /health e recebia a tela de
// login do dashboard (200 OK, mas com HTML em vez de "ok") em vez do
// healthcheck de verdade. Causa: dashboardRouter.use(requireDashboardSession)
// sem path aplicava a QUALQUER rota que passasse pelo dashboardRouter
// (montado sem prefixo em index.ts), inclusive /health, que so e registrada
// depois dele. Mesma familia de bug do teste acima, so que sem sessao de
// admin nenhuma no meio -- so precisa do dashboardRouter no caminho.
test("REGRESSAO: /health responde 'ok' mesmo sem sessao, com o dashboardRouter montado junto", async () => {
  const server = await startFullAppTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/health`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(body, "ok");
  } finally {
    await server.close();
  }
});
