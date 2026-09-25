import { Router } from "express";
import { listBillAlerts, createBillAlert, deactivateBillAlert } from "../bills/service";
import { renderPage } from "./layout";
import { normalizeBrazilPhone, escapeHtml, parsePagination, paginate, renderPagination } from "./utils";

export const billsRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

function formatDateBr(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

billsRouter.get("/dashboard/bills", (req, res) => {
  const phone = getPhone(req);
  const qs = `phone=${encodeURIComponent(phone)}`;
  const bills = listBillAlerts(phone);
  const { page, perPage } = parsePagination(req.query);
  const pageItems = paginate(bills, page, perPage);

  const rows = pageItems.length
    ? pageItems
        .map((b) => {
          const recurrence =
            b.recurrence_type === "interval" ? `A cada ${b.interval_days} dia(s)` : `Todo dia ${b.day_of_month} do mês`;
          const next =
            b.recurrence_type === "interval" && b.next_due_date ? formatDateBr(b.next_due_date) : "—";
          return `
      <tr>
        <td data-label="Alerta">${escapeHtml(b.name)}</td>
        <td data-label="Recorrência">${escapeHtml(recurrence)}</td>
        <td data-label="Próximo aviso">${next}</td>
        <td class="row-actions">
          <form class="inline" method="post" action="/dashboard/bills/${b.id}/delete?${qs}" onsubmit="return confirm('Excluir esse alerta?')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="empty">Nenhum alerta de conta fixa ainda.</td></tr>`;

  const body = `
  <header><h1>Alertas de contas fixas</h1></header>
  <p style="color:var(--muted);font-size:0.86rem;margin:0 0 16px">O assistente te pergunta no WhatsApp, no dia certo, se você já pagou/fez. Se responder que não, ele pergunta de novo no dia seguinte.</p>

  <div class="table-wrap"><table class="mobile-cards">
    <tr><th>Alerta</th><th>Recorrência</th><th>Próximo aviso</th><th></th></tr>
    ${rows}
  </table></div>
  ${renderPagination({ basePath: "/dashboard/bills", params: { phone }, page, perPage, total: bills.length })}

  <h2 style="font-size:0.95rem;margin:28px 0 12px">Novo alerta</h2>
  <form class="card-form" method="post" action="/dashboard/bills/new?${qs}">
    <label>Nome</label>
    <input type="text" name="name" required placeholder="Ex: Conta de água">

    <label>Repetir</label>
    <select name="recurrence" id="bill-recurrence" onchange="document.getElementById('bill-day').hidden=this.value!=='day_of_month';document.getElementById('bill-interval').hidden=this.value!=='interval'">
      <option value="day_of_month">Todo mês, num dia fixo</option>
      <option value="interval">A cada X dias</option>
    </select>

    <div id="bill-day">
      <label>Dia do mês (1 a 31)</label>
      <input type="number" name="day_of_month" min="1" max="31" value="10">
    </div>
    <div id="bill-interval" hidden>
      <label>A cada quantos dias</label>
      <input type="number" name="interval_days" min="1" max="3650" value="30">
    </div>

    <div class="actions"><button type="submit" class="btn">Adicionar</button></div>
  </form>`;

  res.send(renderPage({ title: "Alertas de contas", phone, active: "bills", body }));
});

billsRouter.post("/dashboard/bills/new", (req, res) => {
  const phone = getPhone(req);
  const name = String(req.body.name || "").trim();
  if (name) {
    if (req.body.recurrence === "interval") {
      const intervalDays = Math.floor(Number(req.body.interval_days));
      if (Number.isFinite(intervalDays) && intervalDays >= 1 && intervalDays <= 3650) createBillAlert({ fromNumber: phone, name, intervalDays });
    } else {
      const dayOfMonth = Math.floor(Number(req.body.day_of_month));
      if (Number.isFinite(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) createBillAlert({ fromNumber: phone, name, dayOfMonth });
    }
  }
  res.redirect(`/dashboard/bills?phone=${encodeURIComponent(phone)}`);
});

billsRouter.post("/dashboard/bills/:id/delete", (req, res) => {
  const phone = getPhone(req);
  deactivateBillAlert(phone, Number(req.params.id));
  res.redirect(`/dashboard/bills?phone=${encodeURIComponent(phone)}`);
});
