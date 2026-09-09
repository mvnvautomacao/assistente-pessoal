import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer, startAdminTestServer } from "../helpers/app";
import * as whatsappClient from "../../src/whatsapp/client";
import { allowNumber } from "../../src/access/allowlist";
import { upsertDashboardPassword } from "../../src/dashboard/accounts";
import { hashPassword } from "../../src/auth/password";
import { config } from "../../src/config";

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
