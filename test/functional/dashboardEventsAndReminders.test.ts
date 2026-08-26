import { test } from "node:test";
import assert from "node:assert/strict";
import { startDashboardTestServer } from "../helpers/app";
import { findUpcomingEvents, getEventById } from "../../src/events/service";
import { listReminders, getReminderById } from "../../src/reminders/service";

const A = "551100080001";
const B = "551100080002";

// findUpcomingEvents (usado pra localizar o evento criado nos testes) so olha os
// proximos 60 dias -- datas fixas la em 2099 nunca apareceriam.
function nearFutureDateTimeLocal(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

async function withServer(fn: (baseUrl: string) => Promise<void>) {
  const server = await startDashboardTestServer();
  try {
    await fn(server.baseUrl);
  } finally {
    await server.close();
  }
}

test("criar, editar e excluir evento pelo dashboard, com aviso customizado", async () => {
  await withServer(async (baseUrl) => {
    const start = nearFutureDateTimeLocal(5);
    await fetch(`${baseUrl}/dashboard/events/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Evento dashboard", start, reminder_minutes: "15" }),
    });
    const created = findUpcomingEvents(A, "Evento dashboard")[0];
    assert.ok(created);
    assert.equal(created.reminder_minutes, 15);
    assert.equal(created.start, `${start}:00-03:00`);

    await fetch(`${baseUrl}/dashboard/events/${created.id}?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Evento editado", start: nearFutureDateTimeLocal(6), reminder_minutes: "5" }),
    });
    const updated = getEventById(A, created.id)!;
    assert.equal(updated.title, "Evento editado");
    assert.equal(updated.reminder_minutes, 5);

    await fetch(`${baseUrl}/dashboard/events/${created.id}/delete?phone=${A}`, { method: "POST" });
    assert.equal(getEventById(A, created.id), undefined);
  });
});

test("ajustar o padrao de aviso da agenda so afeta o numero que pediu", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/dashboard/events/settings?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reminder_minutes: "45" }),
    });

    const start = nearFutureDateTimeLocal(10);
    await fetch(`${baseUrl}/dashboard/events/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Usa padrao 45", start }),
    });
    await fetch(`${baseUrl}/dashboard/events/new?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Usa padrao 60 de B", start }),
    });

    assert.equal(findUpcomingEvents(A, "Usa padrao 45")[0].reminder_minutes, 45);
    assert.equal(findUpcomingEvents(B, "Usa padrao 60 de B")[0].reminder_minutes, 60);
  });
});

test("SEGURANCA: numero B nao consegue editar nem excluir evento de A", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/dashboard/events/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Evento protegido", start: nearFutureDateTimeLocal(15) }),
    });
    const target = findUpcomingEvents(A, "Evento protegido")[0];

    await fetch(`${baseUrl}/dashboard/events/${target.id}?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ title: "Hackeado", start: "2000-01-01T00:00" }),
    });
    assert.equal(getEventById(A, target.id)!.title, "Evento protegido");

    await fetch(`${baseUrl}/dashboard/events/${target.id}/delete?phone=${B}`, { method: "POST" });
    assert.ok(getEventById(A, target.id));
  });
});

test("criar, editar e excluir lembrete pelo dashboard", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/dashboard/reminders/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: "Lembrete dashboard", due_at: "2099-06-01T10:00" }),
    });
    const created = listReminders(A).find((r) => r.message === "Lembrete dashboard")!;
    assert.ok(created);
    assert.equal(created.due_at, "2099-06-01T10:00:00-03:00");

    await fetch(`${baseUrl}/dashboard/reminders/${created.id}?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: "Lembrete editado", due_at: "2099-06-02T11:00" }),
    });
    assert.equal(getReminderById(A, created.id)!.message, "Lembrete editado");

    await fetch(`${baseUrl}/dashboard/reminders/${created.id}/delete?phone=${A}`, { method: "POST" });
    assert.equal(getReminderById(A, created.id), undefined);
  });
});

test("SEGURANCA: numero B nao consegue editar nem excluir lembrete de A", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/dashboard/reminders/new?phone=${A}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: "Lembrete protegido", due_at: "2099-08-01T10:00" }),
    });
    const target = listReminders(A).find((r) => r.message === "Lembrete protegido")!;

    await fetch(`${baseUrl}/dashboard/reminders/${target.id}?phone=${B}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: "Hackeado", due_at: "2000-01-01T00:00" }),
    });
    assert.equal(getReminderById(A, target.id)!.message, "Lembrete protegido");

    await fetch(`${baseUrl}/dashboard/reminders/${target.id}/delete?phone=${B}`, { method: "POST" });
    assert.ok(getReminderById(A, target.id));
  });
});
