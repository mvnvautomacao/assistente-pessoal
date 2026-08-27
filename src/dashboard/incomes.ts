import { Router } from "express";
import {
  getIncomesForMonth,
  getAvailableIncomeMonths,
  getIncomeById,
  updateIncome,
  deleteIncome,
  insertIncome,
  getAllIncomes,
} from "../incomes/service";
import { renderPage, renderPhoneGate } from "./layout";
import {
  normalizeBrazilPhone,
  escapeHtml,
  formatMoney,
  formatAmountInput,
  formatDate,
  monthLabel,
  shiftMonth,
  todaySP,
  MONEY_MASK_SCRIPT,
  buildCsv,
  formatAmountCsv,
} from "./utils";

export const incomesRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

// exporta TODAS as entradas (todo o historico, nao so o mes em tela) -- pensado
// pra declarar imposto de renda ou levar pra uma planilha externa.
incomesRouter.get("/dashboard/incomes/export.csv", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const items = getAllIncomes(phone);
  const rows = items.map((i) => [formatDate(i.date), i.description, formatAmountCsv(i.amount)]);
  const csv = buildCsv(["Data", "Descrição", "Valor (R$)"], rows);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="entradas-${phone}.csv"`);
  res.send(csv);
});

incomesRouter.get("/dashboard/incomes", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const months = getAvailableIncomeMonths(phone);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : months[0] ?? currentMonth;

  const incomes = getIncomesForMonth(phone, month);
  const monthTotal = incomes.reduce((sum, i) => sum + i.amount, 0);

  const monthOptions = months.length
    ? months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")
    : `<option value="${month}" selected>${escapeHtml(monthLabel(month))}</option>`;

  const incomeRows = incomes.length
    ? incomes
        .map(
          (i) => `
      <tr>
        <td>${formatDate(i.date)}</td>
        <td>${escapeHtml(i.description)}</td>
        <td class="amount">${formatMoney(i.amount)}</td>
        <td class="row-actions">
          <a class="link-action" href="/dashboard/incomes/${i.id}/edit?phone=${encodeURIComponent(phone)}">Editar</a>
          <form class="inline" method="post" action="/dashboard/incomes/${i.id}/delete?phone=${encodeURIComponent(phone)}" onsubmit="return confirm('Excluir essa entrada?')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="empty">Nenhuma entrada registrada neste mês.</td></tr>`;

  const body = `
  <header>
    <h1>${escapeHtml(monthLabel(month))}</h1>
    <div class="header-actions">
      <a class="btn secondary" href="/dashboard/incomes/export.csv?phone=${encodeURIComponent(phone)}">Exportar CSV</a>
      <a class="btn" href="/dashboard/incomes/new?phone=${encodeURIComponent(phone)}">+ Nova entrada</a>
    </div>
  </header>
  <div class="month-nav">
    <a class="arrow" href="/dashboard/incomes?phone=${encodeURIComponent(phone)}&month=${shiftMonth(month, -1)}">‹</a>
    <form method="get" style="margin:0">
      <input type="hidden" name="phone" value="${escapeHtml(phone)}">
      <select name="month" onchange="this.form.submit()">${monthOptions}</select>
    </form>
    <a class="arrow" href="/dashboard/incomes?phone=${encodeURIComponent(phone)}&month=${shiftMonth(month, 1)}">›</a>
  </div>

  <div class="cards">
    <div class="card"><div class="label">Total do mês</div><div class="value">${formatMoney(monthTotal)}</div></div>
    <div class="card"><div class="label">Nº de entradas</div><div class="value">${incomes.length}</div></div>
  </div>

  <div class="table-wrap"><table>
    <tr><th>Data</th><th>Descrição</th><th style="text-align:right">Valor</th><th></th></tr>
    ${incomeRows}
  </table></div>`;

  res.send(renderPage({ title: `Entradas — ${monthLabel(month)}`, phone, active: "incomes", body }));
});

function incomeForm(opts: { phone: string; action: string; submitLabel: string; amount?: number; description?: string; date?: string }) {
  const body = `
  <h1>${opts.submitLabel === "Salvar" ? "Editar entrada" : "Nova entrada"}</h1>
  <form class="card-form" method="post" action="${opts.action}">
    <label>Valor (R$)</label>
    <input type="text" inputmode="decimal" class="money-mask" placeholder="0,00" autocomplete="off" required
      value="${opts.amount !== undefined ? formatAmountInput(opts.amount) : ""}">
    <input type="hidden" name="amount"
      value="${opts.amount !== undefined ? opts.amount.toFixed(2) : ""}">

    <label>Descrição</label>
    <input type="text" name="description" required value="${escapeHtml(opts.description ?? "")}" placeholder="Ex: Salário, Freela, Reembolso">

    <label>Data</label>
    <input type="date" name="date" required value="${opts.date ?? todaySP()}">

    <div class="actions">
      <button type="submit" class="btn">${opts.submitLabel}</button>
      <a href="/dashboard/incomes?phone=${encodeURIComponent(opts.phone)}" class="btn secondary">Cancelar</a>
    </div>
  </form>
  ${MONEY_MASK_SCRIPT}`;
  return body;
}

incomesRouter.get("/dashboard/incomes/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const body = incomeForm({ phone, action: `/dashboard/incomes/new?phone=${encodeURIComponent(phone)}`, submitLabel: "Adicionar" });
  res.send(renderPage({ title: "Nova entrada", phone, active: "incomes", body }));
});

incomesRouter.post("/dashboard/incomes/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const { amount, description, date } = req.body;
  insertIncome({
    fromNumber: phone,
    amount: Number(amount),
    description: String(description || "").trim() || "Entrada",
    date: date ? String(date) : todaySP(),
  });

  res.redirect(`/dashboard/incomes?phone=${encodeURIComponent(phone)}`);
});

incomesRouter.get("/dashboard/incomes/:id/edit", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const income = getIncomeById(phone, Number(req.params.id));
  if (!income) return res.status(404).send("Entrada não encontrada.");

  const body = incomeForm({
    phone,
    action: `/dashboard/incomes/${income.id}?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Salvar",
    amount: income.amount,
    description: income.description,
    date: income.date.slice(0, 10),
  });
  res.send(renderPage({ title: "Editar entrada", phone, active: "incomes", body }));
});

incomesRouter.post("/dashboard/incomes/:id", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const { amount, description, date } = req.body;
  updateIncome(phone, Number(req.params.id), {
    amount: Number(amount),
    description: String(description || "").trim() || "Entrada",
    date: date ? String(date) : todaySP(),
  });

  res.redirect(`/dashboard/incomes?phone=${encodeURIComponent(phone)}`);
});

incomesRouter.post("/dashboard/incomes/:id/delete", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  deleteIncome(phone, Number(req.params.id));
  res.redirect(`/dashboard/incomes?phone=${encodeURIComponent(phone)}`);
});
