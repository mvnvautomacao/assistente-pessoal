import { Router } from "express";
import {
  listUpcomingEvents,
  getEventsForMonth,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
  getEventReminderMinutes,
  setEventReminderMinutes,
  EventRow,
} from "../events/service";
import { renderPage, renderPhoneGate } from "./layout";
import {
  normalizeBrazilPhone,
  escapeHtml,
  toSPDateTimeLocal,
  fromSPDateTimeLocal,
  todaySP,
  monthLabel,
  shiftMonth,
  calendarCells,
} from "./utils";

export const eventsRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// "Hoje" se for o dia de hoje, senao a data por extenso (ex: "Terca-feira, 25 de agosto")
function spotlightLabel(selected: string, today: string): string {
  if (selected === today) return "Hoje";
  const [y, m, d] = selected.split("-").map(Number);
  // meio-dia UTC = 09h em Sao Paulo (UTC-3): mesmo dia calendario, sem risco de
  // virar pro dia adjacente ao formatar
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderCalendar(phone: string, month: string, today: string, selected: string, eventsByDay: Map<string, EventRow[]>): string {
  const qs = `phone=${encodeURIComponent(phone)}`;
  const cells = calendarCells(month)
    .map((date) => {
      if (!date) return `<div class="calendar-cell empty"></div>`;
      const dayEvents = eventsByDay.get(date) ?? [];
      const dayNum = Number(date.slice(8, 10));
      const shown = dayEvents.slice(0, 2);
      const extra = dayEvents.length - shown.length;
      const classes = [
        "calendar-cell",
        date === today ? "today" : "",
        date === selected ? "selected" : "",
        dayEvents.length ? "has-events" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
      <div class="${classes}">
        <a class="day-fill" href="/dashboard/events?${qs}&month=${month}&selected=${date}" title="Ver eventos de ${date.split("-").reverse().join("/")}" aria-label="Ver eventos de ${date.split("-").reverse().join("/")}"></a>
        <div class="day-num">
          <span>${dayNum}</span>
          <a class="day-add" href="/dashboard/events/new?${qs}&date=${date}" title="Novo evento em ${date.split("-").reverse().join("/")}">+</a>
        </div>
        ${shown.map((e) => `<a class="ev" href="/dashboard/events/${e.id}/edit?${qs}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</a>`).join("")}
        ${extra > 0 ? `<span class="ev-more">+${extra}</span>` : ""}
      </div>`;
    })
    .join("");

  return `
  <div class="month-nav">
    <a class="arrow" href="/dashboard/events?${qs}&month=${shiftMonth(month, -1)}">‹</a>
    <strong>${escapeHtml(monthLabel(month))}</strong>
    <a class="arrow" href="/dashboard/events?${qs}&month=${shiftMonth(month, 1)}">›</a>
  </div>
  <div class="calendar">
    ${WEEKDAY_LABELS.map((l) => `<div class="calendar-weekday">${l}</div>`).join("")}
    ${cells}
  </div>`;
}

eventsRouter.get("/dashboard/events", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const qs = `phone=${encodeURIComponent(phone)}`;
  const days = req.query.days === "60" || req.query.days === "90" ? Number(req.query.days) : 30;
  const events = listUpcomingEvents(phone, days);

  const today = todaySP();
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : today.slice(0, 7);
  const selected = typeof req.query.selected === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.selected) ? req.query.selected : today;

  // eventos do dia selecionado (hoje, por padrao) sao buscados separado do mes
  // navegado no calendario, pra o destaque continuar certo mesmo se o dia
  // selecionado for de um mes diferente do que esta sendo mostrado
  const selectedEvents = getEventsForMonth(phone, selected.slice(0, 7))
    .filter((e) => e.start.slice(0, 10) === selected)
    .sort((a, b) => a.start.localeCompare(b.start));

  const monthEvents = getEventsForMonth(phone, month);
  const eventsByDay = new Map<string, EventRow[]>();
  for (const e of monthEvents) {
    const day = e.start.slice(0, 10);
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(e);
  }

  const spotlight = `
  <div class="spotlight">
    <h2>${escapeHtml(spotlightLabel(selected, today))}</h2>
    ${
      selectedEvents.length
        ? selectedEvents
            .map(
              (e) => `
      <div class="spotlight-event">
        <a href="/dashboard/events/${e.id}/edit?${qs}" style="display:flex;gap:10px;align-items:baseline;flex:1">
          <span class="time">${toSPDateTimeLocal(e.start).slice(11, 16)}</span>
          <span class="title">${escapeHtml(e.title)}${e.location ? ` — ${escapeHtml(e.location)}` : ""}</span>
        </a>
      </div>`
            )
            .join("")
        : `<p style="color:var(--muted);font-size:0.88rem;margin:0">Nenhum evento ${selected === today ? "hoje" : "nesse dia"}.</p>`
    }
  </div>`;

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

  ${spotlight}

  ${renderCalendar(phone, month, today, selected, eventsByDay)}

  <h2 style="font-size:0.95rem;margin:0 0 12px">Próximos eventos</h2>
  <div class="chip-row">${dayChip(30, "30 dias")}${dayChip(60, "60 dias")}${dayChip(90, "90 dias")}</div>

  <div class="table-wrap"><table>
    <tr><th>Quando</th><th>Título</th><th>Local</th><th></th></tr>
    ${rows}
  </table></div>

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
  // vindo do "+" de um dia especifico no calendario: pre-preenche a data (horario
  // padrao 09:00, o usuario ajusta se quiser)
  const dateParam = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  const body = eventForm({
    phone,
    action: `/dashboard/events/new?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Adicionar",
    start: dateParam ? `${dateParam}T09:00` : undefined,
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
