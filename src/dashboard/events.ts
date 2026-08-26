import { Router } from "express";
import {
  listUpcomingEvents,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
  getEventReminderMinutes,
  setEventReminderMinutes,
} from "../events/service";
import { renderPage, renderPhoneGate } from "./layout";
import { normalizeBrazilPhone, escapeHtml, toSPDateTimeLocal, fromSPDateTimeLocal } from "./utils";

export const eventsRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

eventsRouter.get("/dashboard/events", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const qs = `phone=${encodeURIComponent(phone)}`;
  const days = req.query.days === "60" || req.query.days === "90" ? Number(req.query.days) : 30;
  const events = listUpcomingEvents(phone, days);

  const rows = events.length
    ? events
        .map(
          (e) => `
      <tr>
        <td>${escapeHtml(toSPDateTimeLocal(e.start)).replace("T", " ")}</td>
        <td>${escapeHtml(e.title)}</td>
        <td>${escapeHtml(e.location ?? "—")}</td>
        <td class="row-actions">
          <a class="link-action" href="/dashboard/events/${e.id}/edit?${qs}">Editar</a>
          <form class="inline" method="post" action="/dashboard/events/${e.id}/delete?${qs}" onsubmit="return confirm('Excluir esse evento da agenda?')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="empty">Nenhum evento nos próximos ${days} dias.</td></tr>`;

  const dayChip = (d: number, label: string) =>
    `<a href="/dashboard/events?${qs}&days=${d}" class="btn ${d === days ? "" : "secondary"}" style="padding:6px 12px">${label}</a>`;

  const reminderMinutes = getEventReminderMinutes(phone);

  const body = `
  <header>
    <h1>Agenda</h1>
    <a class="btn" href="/dashboard/events/new?${qs}">+ Novo evento</a>
  </header>
  <p class="hint" style="color:var(--muted);font-size:0.82rem;margin:-8px 0 20px">
    Agenda própria, guardada no banco de dados e isolada por número — ainda não sincroniza com o Google Calendar.
  </p>
  <div class="chip-row">${dayChip(30, "30 dias")}${dayChip(60, "60 dias")}${dayChip(90, "90 dias")}</div>

  <table>
    <tr><th>Quando</th><th>Título</th><th>Local</th><th></th></tr>
    ${rows}
  </table>

  <h2 style="font-size:0.95rem;margin:28px 0 12px">Aviso padrão antes dos eventos</h2>
  <form class="card-form" method="post" action="/dashboard/events/settings?${qs}">
    <label>Avisar no WhatsApp quantos minutos antes de cada evento</label>
    <input type="number" name="reminder_minutes" min="0" step="1" required value="${reminderMinutes}">
    <p style="color:var(--muted);font-size:0.8rem;margin:8px 0 0">
      Vale pra eventos novos. Um evento específico pode ter um aviso diferente — ajuste isso ao editá-lo.
    </p>
    <div class="actions"><button type="submit" class="btn">Salvar</button></div>
  </form>`;

  res.send(renderPage({ title: "Agenda", phone, active: "events", body }));
});

eventsRouter.post("/dashboard/events/settings", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const minutes = Number(req.body.reminder_minutes);
  if (Number.isFinite(minutes) && minutes >= 0) setEventReminderMinutes(phone, Math.round(minutes));
  res.redirect(`/dashboard/events?phone=${encodeURIComponent(phone)}`);
});

function eventForm(opts: {
  phone: string;
  action: string;
  submitLabel: string;
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  reminderMinutes: number;
}) {
  return `
  <h1>${opts.submitLabel === "Salvar" ? "Editar evento" : "Novo evento"}</h1>
  <form class="card-form" method="post" action="${opts.action}">
    <label>Título</label>
    <input type="text" name="title" required value="${escapeHtml(opts.title ?? "")}">

    <label>Início</label>
    <input type="datetime-local" name="start" required value="${opts.start ?? ""}">

    <label>Fim (opcional — padrão 1h depois do início)</label>
    <input type="datetime-local" name="end" value="${opts.end ?? ""}">

    <label>Local (opcional)</label>
    <input type="text" name="location" value="${escapeHtml(opts.location ?? "")}">

    <label>Avisar no WhatsApp quantos minutos antes</label>
    <input type="number" name="reminder_minutes" min="0" step="1" required value="${opts.reminderMinutes}">

    <div class="actions">
      <button type="submit" class="btn">${opts.submitLabel}</button>
      <a href="/dashboard/events?phone=${encodeURIComponent(opts.phone)}" class="btn secondary">Cancelar</a>
    </div>
  </form>`;
}

eventsRouter.get("/dashboard/events/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const body = eventForm({
    phone,
    action: `/dashboard/events/new?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Adicionar",
    reminderMinutes: getEventReminderMinutes(phone),
  });
  res.send(renderPage({ title: "Novo evento", phone, active: "events", body }));
});

eventsRouter.post("/dashboard/events/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const title = String(req.body.title || "").trim();
  const start = String(req.body.start || "");
  const end = String(req.body.end || "");
  const location = String(req.body.location || "").trim();
  const reminderMinutes = Number(req.body.reminder_minutes);
  if (title && start) {
    createEvent({
      fromNumber: phone,
      title,
      start: fromSPDateTimeLocal(start),
      end: end ? fromSPDateTimeLocal(end) : undefined,
      location: location || undefined,
      reminderMinutes: Number.isFinite(reminderMinutes) ? reminderMinutes : undefined,
    });
  }
  res.redirect(`/dashboard/events?phone=${encodeURIComponent(phone)}`);
});

eventsRouter.get("/dashboard/events/:id/edit", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const event = getEventById(phone, Number(req.params.id));
  if (!event) return res.status(404).send("Evento não encontrado.");

  const body = eventForm({
    phone,
    action: `/dashboard/events/${event.id}?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Salvar",
    title: event.title,
    start: toSPDateTimeLocal(event.start),
    end: toSPDateTimeLocal(event.end),
    location: event.location ?? "",
    reminderMinutes: event.reminder_minutes,
  });
  res.send(renderPage({ title: "Editar evento", phone, active: "events", body }));
});

eventsRouter.post("/dashboard/events/:id", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const title = String(req.body.title || "").trim();
  const start = String(req.body.start || "");
  const end = String(req.body.end || "");
  const location = String(req.body.location || "").trim();
  const reminderMinutes = Number(req.body.reminder_minutes);
  if (title && start) {
    updateEvent(phone, Number(req.params.id), {
      title,
      start: fromSPDateTimeLocal(start),
      end: end ? fromSPDateTimeLocal(end) : undefined,
      location: location || undefined,
      reminderMinutes: Number.isFinite(reminderMinutes) ? reminderMinutes : getEventReminderMinutes(phone),
    });
  }
  res.redirect(`/dashboard/events?phone=${encodeURIComponent(phone)}`);
});

eventsRouter.post("/dashboard/events/:id/delete", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  deleteEvent(phone, Number(req.params.id));
  res.redirect(`/dashboard/events?phone=${encodeURIComponent(phone)}`);
});
