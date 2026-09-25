import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { listBillAlerts, createBillAlert } from "../../src/bills/service";

const A = "551100070101";
const B = "551100070102";

async function withServer(fn: (baseUrl: string, authHeaders: (phone: string) => Record<string, string>) => Promise<void>) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl, server.authHeaders);
  } finally {
    await server.close();
  }
}

const form = { "Content-Type": "application/x-www-form-urlencoded" };

test("dashboard: menu de contas fixas lista, cria (dia fixo e intervalo) e exclui alertas", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    await fetch(`${baseUrl}/dashboard/bills/new`, {
      method: "POST",
      headers: { ...form, ...authHeaders(A) },
      body: new URLSearchParams({ name: "Conta de agua painel", recurrence: "day_of_month", day_of_month: "5" }),
    });
    await fetch(`${baseUrl}/dashboard/bills/new`, {
      method: "POST",
      headers: { ...form, ...authHeaders(A) },
      body: new URLSearchParams({ name: "Racao painel", recurrence: "interval", interval_days: "45" }),
    });

    const bills = listBillAlerts(A);
    const agua = bills.find((b) => b.name === "Conta de agua painel")!;
    const racao = bills.find((b) => b.name === "Racao painel")!;
    assert.equal(agua.recurrence_type, "day_of_month");
    assert.equal(agua.day_of_month, 5);
    assert.equal(racao.recurrence_type, "interval");
    assert.equal(racao.interval_days, 45);

    const html = await (await fetch(`${baseUrl}/dashboard/bills`, { headers: authHeaders(A) })).text();
    assert.ok(html.includes("Conta de agua painel"));
    assert.ok(html.includes("Todo dia 5 do mês"));
    assert.ok(html.includes("A cada 45 dia(s)"));
    assert.ok(html.includes("Contas fixas")); // aba no menu

    await fetch(`${baseUrl}/dashboard/bills/${agua.id}/delete`, { method: "POST", headers: authHeaders(A) });
    assert.ok(!listBillAlerts(A).some((b) => b.id === agua.id));
  });
});

test("dashboard: valores invalidos de dia/intervalo nao criam alerta", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    await fetch(`${baseUrl}/dashboard/bills/new`, {
      method: "POST",
      headers: { ...form, ...authHeaders(A) },
      body: new URLSearchParams({ name: "dia invalido", recurrence: "day_of_month", day_of_month: "45" }),
    });
    assert.ok(!listBillAlerts(A).some((b) => b.name === "dia invalido"));
  });
});

test("SEGURANCA: numero B nao ve nem exclui alerta de conta de A", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const bill = createBillAlert({ fromNumber: A, name: "so do A painel", dayOfMonth: 12 });
    const htmlB = await (await fetch(`${baseUrl}/dashboard/bills`, { headers: authHeaders(B) })).text();
    assert.ok(!htmlB.includes("so do A painel"));

    await fetch(`${baseUrl}/dashboard/bills/${bill.id}/delete`, { method: "POST", headers: authHeaders(B) });
    assert.ok(listBillAlerts(A).some((b) => b.id === bill.id));
  });
});

test("dashboard: editar alerta muda nome e recorrencia (dia fixo -> intervalo), e editar so o nome nao zera o prazo", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const E = "551100070103";
    const bill = createBillAlert({ fromNumber: E, name: "Luz editar", dayOfMonth: 10 });

    const editHtml = await (await fetch(`${baseUrl}/dashboard/bills/${bill.id}/edit`, { headers: authHeaders(E) })).text();
    assert.ok(editHtml.includes("Luz editar"));

    await fetch(`${baseUrl}/dashboard/bills/${bill.id}`, {
      method: "POST",
      headers: { ...form, ...authHeaders(E) },
      body: new URLSearchParams({ name: "Energia editada", recurrence: "interval", interval_days: "20" }),
    });
    let updated = listBillAlerts(E).find((b) => b.id === bill.id)!;
    assert.equal(updated.name, "Energia editada");
    assert.equal(updated.recurrence_type, "interval");
    assert.equal(updated.interval_days, 20);
    const nextDue = updated.next_due_date;

    // so o nome: recorrencia igual, next_due_date preservado
    await fetch(`${baseUrl}/dashboard/bills/${bill.id}`, {
      method: "POST",
      headers: { ...form, ...authHeaders(E) },
      body: new URLSearchParams({ name: "Energia so nome", recurrence: "interval", interval_days: "20" }),
    });
    updated = listBillAlerts(E).find((b) => b.id === bill.id)!;
    assert.equal(updated.name, "Energia so nome");
    assert.equal(updated.next_due_date, nextDue);
  });
});

test("SEGURANCA: numero B nao consegue editar alerta de conta de A", async () => {
  await withServer(async (baseUrl, authHeaders) => {
    const bill = createBillAlert({ fromNumber: A, name: "so do A editar", dayOfMonth: 3 });
    await fetch(`${baseUrl}/dashboard/bills/${bill.id}`, {
      method: "POST",
      headers: { ...form, ...authHeaders(B) },
      body: new URLSearchParams({ name: "hackeado", recurrence: "day_of_month", day_of_month: "20" }),
    });
    const still = listBillAlerts(A).find((b) => b.id === bill.id)!;
    assert.equal(still.name, "so do A editar");
    assert.equal(still.day_of_month, 3);
  });
});
