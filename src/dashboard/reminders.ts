import { Router } from "express";
import { listReminders, getReminderById, createReminder, updateReminder, deleteReminder } from "../reminders/service";
import { renderPage, renderPhoneGate } from "./layout";
import { normalizeBrazilPhone, escapeHtml, toSPDateTimeLocal, fromSPDateTimeLocal } from "./utils";

export const remindersRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

remindersRouter.get("/dashboard/reminders", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const qs = `phone=${encodeURIComponent(phone)}`;
  const reminders = listReminders(phone);

  const rows = reminders.length
    ? reminders
        .map(
          (r) => `
      <tr>
        <td>${escapeHtml(toSPDateTimeLocal(r.due_at)).replace("T", " ")}</td>
        <td>${escapeHtml(r.message)}</td>
        <td><span class="tag" style="${r.sent ? "background:#e5e7eb;color:#374151" : ""}">${r.sent ? "Enviado" : "Pendente"}</span></td>
        <td class="row-actions">
          <a class="link-action" href="/dashboard/reminders/${r.id}/edit?${qs}">Editar</a>
          <form class="inline" method="post" action="/dashboard/reminders/${r.id}/delete?${qs}" onsubmit="return confirm('Excluir esse lembrete?')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="empty">Nenhum lembrete ainda.</td></tr>`;

  const body = `
  <header>
    <h1>Lembretes</h1>
    <a class="btn" href="/dashboard/reminders/new?${qs}">+ Novo lembrete</a>
  </header>

  <table>
    <tr><th>Data/hora</th><th>Mensagem</th><th>Status</th><th></th></tr>
    ${rows}
  </table>`;

  res.send(renderPage({ title: "Lembretes", phone, active: "reminders", body }));
});

function reminderForm(opts: { phone: string; action: string; submitLabel: string; message?: string; dueAt?: string }) {
  return `
  <h1>${opts.submitLabel === "Salvar" ? "Editar lembrete" : "Novo lembrete"}</h1>
  <form class="card-form" method="post" action="${opts.action}">
    <label>Mensagem</label>
    <input type="text" name="message" required value="${escapeHtml(opts.message ?? "")}">

    <label>Data e hora</label>
    <input type="datetime-local" name="due_at" required value="${opts.dueAt ?? ""}">

    <div class="actions">
      <button type="submit" class="btn">${opts.submitLabel}</button>
      <a href="/dashboard/reminders?phone=${encodeURIComponent(opts.phone)}" class="btn secondary">Cancelar</a>
    </div>
  </form>`;
}

remindersRouter.get("/dashboard/reminders/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const body = reminderForm({ phone, action: `/dashboard/reminders/new?phone=${encodeURIComponent(phone)}`, submitLabel: "Adicionar" });
  res.send(renderPage({ title: "Novo lembrete", phone, active: "reminders", body }));
});

remindersRouter.post("/dashboard/reminders/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const message = String(req.body.message || "").trim();
  const dueAt = String(req.body.due_at || "");
  if (message && dueAt) createReminder(phone, message, fromSPDateTimeLocal(dueAt));
  res.redirect(`/dashboard/reminders?phone=${encodeURIComponent(phone)}`);
});

remindersRouter.get("/dashboard/reminders/:id/edit", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const reminder = getReminderById(phone, Number(req.params.id));
  if (!reminder) return res.status(404).send("Lembrete não encontrado.");

  const body = reminderForm({
    phone,
    action: `/dashboard/reminders/${reminder.id}?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Salvar",
    message: reminder.message,
    dueAt: toSPDateTimeLocal(reminder.due_at),
  });
  res.send(renderPage({ title: "Editar lembrete", phone, active: "reminders", body }));
});

remindersRouter.post("/dashboard/reminders/:id", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const message = String(req.body.message || "").trim();
  const dueAt = String(req.body.due_at || "");
  if (message && dueAt) updateReminder(phone, Number(req.params.id), { message, dueAt: fromSPDateTimeLocal(dueAt) });
  res.redirect(`/dashboard/reminders?phone=${encodeURIComponent(phone)}`);
});

remindersRouter.post("/dashboard/reminders/:id/delete", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  deleteReminder(phone, Number(req.params.id));
  res.redirect(`/dashboard/reminders?phone=${encodeURIComponent(phone)}`);
});
