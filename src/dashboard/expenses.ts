import { Router } from "express";
import {
  getExpensesForMonth,
  getCategoryTotalsForMonth,
  getPaymentMethodTotalsForMonth,
  getAvailableMonths,
  getExpenseById,
  updateExpense,
  deleteExpense,
  insertExpense,
  listCategories,
  listPaymentMethods,
  searchExpenses,
  getAllExpenses,
  ExpenseListItem,
} from "../expenses/service";
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

export const expensesRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

function barList(items: { name: string; total: number }[]) {
  if (!items.length) return `<p class="empty">Nada neste mês.</p>`;
  const max = Math.max(...items.map((i) => i.total));
  return items
    .map(
      (i) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(i.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max((i.total / max) * 100, 3)}%"></div></div>
        <div class="bar-value">${formatMoney(i.total)}</div>
      </div>`
    )
    .join("");
}

function categoryOptions(phone: string, selectedId: number | null) {
  const options = listCategories(phone)
    .map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
  return `<option value="">Sem categoria</option>${options}`;
}

function paymentMethodOptions(phone: string, selectedId: number | null) {
  const options = listPaymentMethods(phone)
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  return `<option value="">Não informado</option>${options}`;
}

function expenseRow(phone: string, e: ExpenseListItem) {
  return `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td><span class="tag">${escapeHtml(e.category ?? "Sem categoria")}</span></td>
        <td>${escapeHtml(e.payment_method ?? "—")}</td>
        <td class="amount">${formatMoney(e.amount)}</td>
        <td class="row-actions">
          <a class="link-action" href="/dashboard/expenses/${e.id}/edit?phone=${encodeURIComponent(phone)}">Editar</a>
          <form class="inline" method="post" action="/dashboard/expenses/${e.id}/delete?phone=${encodeURIComponent(phone)}" onsubmit="return confirm('Excluir esse gasto?')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`;
}

// campo de busca no topo da pagina de gastos: navegacao normal e so mes a mes,
// entao pra achar um gasto antigo sem lembrar o mes exato precisa de uma busca
// por texto que olhe todos os meses de uma vez (ver searchExpenses).
function searchBox(phone: string, q: string) {
  return `
  <form class="search-row" method="get" action="/dashboard">
    <input type="hidden" name="phone" value="${escapeHtml(phone)}">
    <input type="text" name="q" placeholder="Buscar gasto por descrição (todos os meses)..." value="${escapeHtml(q)}">
    <button type="submit" class="btn secondary">Buscar</button>
    ${q ? `<a href="/dashboard?phone=${encodeURIComponent(phone)}" class="btn secondary">Limpar</a>` : ""}
  </form>`;
}

// exporta TODOS os gastos (todo o historico, nao so o mes em tela) -- pensado
// pra declarar imposto de renda ou levar pra uma planilha externa.
expensesRouter.get("/dashboard/expenses/export.csv", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const items = getAllExpenses(phone);
  const rows = items.map((e) => [
    formatDate(e.date),
    e.description,
    e.category ?? "Sem categoria",
    e.payment_method ?? "",
    formatAmountCsv(e.amount),
  ]);
  const csv = buildCsv(["Data", "Descrição", "Categoria", "Forma de pagamento", "Valor (R$)"], rows);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gastos-${phone}.csv"`);
  res.send(csv);
});

expensesRouter.get("/dashboard", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (q) {
    const results = searchExpenses(phone, q);
    const rows = results.length
      ? results.map((e) => expenseRow(phone, e)).join("")
      : `<tr><td colspan="6" class="empty">Nenhum gasto encontrado pra "${escapeHtml(q)}".</td></tr>`;

    const body = `
    <header>
      <h1>Busca: "${escapeHtml(q)}"</h1>
      <div class="header-actions">
        <a class="btn secondary" href="/dashboard/expenses/export.csv?phone=${encodeURIComponent(phone)}">Exportar CSV</a>
        <a class="btn" href="/dashboard/expenses/new?phone=${encodeURIComponent(phone)}">+ Novo gasto</a>
      </div>
    </header>
    ${searchBox(phone, q)}
    <p class="empty" style="text-align:left;padding:0 0 16px">${results.length} gasto(s) encontrado(s), de todos os meses.</p>
    <div class="table-wrap"><table>
      <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th style="text-align:right">Valor</th><th></th></tr>
      ${rows}
    </table></div>`;

    res.send(renderPage({ title: `Busca: ${q}`, phone, active: "expenses", body }));
    return;
  }

  const months = getAvailableMonths(phone);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : months[0] ?? currentMonth;

  const expenses = getExpensesForMonth(phone, month);
  const categoryTotals = getCategoryTotalsForMonth(phone, month);
  const paymentTotals = getPaymentMethodTotalsForMonth(phone, month);
  const monthTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const topCategory = categoryTotals[0]?.name ?? "—";

  const monthOptions = months.length
    ? months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")
    : `<option value="${month}" selected>${escapeHtml(monthLabel(month))}</option>`;

  const expenseRows = expenses.length
    ? expenses.map((e) => expenseRow(phone, e)).join("")
    : `<tr><td colspan="6" class="empty">Nenhum gasto registrado neste mês.</td></tr>`;

  const body = `
  <header>
    <h1>${escapeHtml(monthLabel(month))}</h1>
    <div class="header-actions">
      <a class="btn secondary" href="/dashboard/expenses/export.csv?phone=${encodeURIComponent(phone)}">Exportar CSV</a>
      <a class="btn" href="/dashboard/expenses/new?phone=${encodeURIComponent(phone)}">+ Novo gasto</a>
    </div>
  </header>
  ${searchBox(phone, q)}
  <div class="month-nav">
    <a class="arrow" href="/dashboard?phone=${encodeURIComponent(phone)}&month=${shiftMonth(month, -1)}">‹</a>
    <form method="get" style="margin:0">
      <input type="hidden" name="phone" value="${escapeHtml(phone)}">
      <select name="month" onchange="this.form.submit()">${monthOptions}</select>
    </form>
    <a class="arrow" href="/dashboard?phone=${encodeURIComponent(phone)}&month=${shiftMonth(month, 1)}">›</a>
  </div>

  <div class="cards">
    <div class="card"><div class="label">Total do mês</div><div class="value">${formatMoney(monthTotal)}</div></div>
    <div class="card"><div class="label">Maior categoria</div><div class="value">${escapeHtml(topCategory)}</div></div>
    <div class="card"><div class="label">Nº de gastos</div><div class="value">${expenses.length}</div></div>
  </div>

  <div class="panels">
    <div class="panel"><h2>Por categoria</h2>${barList(categoryTotals)}</div>
    <div class="panel"><h2>Por forma de pagamento</h2>${barList(paymentTotals)}</div>
  </div>

  <div class="table-wrap"><table>
    <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th style="text-align:right">Valor</th><th></th></tr>
    ${expenseRows}
  </table></div>`;

  res.send(renderPage({ title: `Gastos — ${monthLabel(month)}`, phone, active: "expenses", body }));
});

function expenseForm(opts: {
  phone: string;
  action: string;
  submitLabel: string;
  amount?: number;
  description?: string;
  date?: string;
  categoryId?: number | null;
  paymentMethodId?: number | null;
}) {
  const body = `
  <h1>${opts.submitLabel === "Salvar" ? "Editar gasto" : "Novo gasto"}</h1>
  <form class="card-form" method="post" action="${opts.action}">
    <label>Valor (R$)</label>
    <input type="text" inputmode="decimal" class="money-mask" placeholder="0,00" autocomplete="off" required
      value="${opts.amount !== undefined ? formatAmountInput(opts.amount) : ""}">
    <input type="hidden" name="amount"
      value="${opts.amount !== undefined ? opts.amount.toFixed(2) : ""}">

    <label>Descrição</label>
    <input type="text" name="description" required value="${escapeHtml(opts.description ?? "")}">

    <label>Data</label>
    <input type="date" name="date" required value="${opts.date ?? todaySP()}">

    <label>Categoria</label>
    <select name="category_id">${categoryOptions(opts.phone, opts.categoryId ?? null)}</select>

    <label>Forma de pagamento</label>
    <select name="payment_method_id">${paymentMethodOptions(opts.phone, opts.paymentMethodId ?? null)}</select>

    <div class="actions">
      <button type="submit" class="btn">${opts.submitLabel}</button>
      <a href="/dashboard?phone=${encodeURIComponent(opts.phone)}" class="btn secondary">Cancelar</a>
    </div>
  </form>
  ${MONEY_MASK_SCRIPT}`;
  return body;
}

expensesRouter.get("/dashboard/expenses/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const body = expenseForm({ phone, action: `/dashboard/expenses/new?phone=${encodeURIComponent(phone)}`, submitLabel: "Adicionar" });
  res.send(renderPage({ title: "Novo gasto", phone, active: "expenses", body }));
});

expensesRouter.post("/dashboard/expenses/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const { amount, description, date, category_id, payment_method_id } = req.body;
  insertExpense({
    fromNumber: phone,
    amount: Number(amount),
    description: String(description || "").trim() || "Gasto",
    // sem data especificada = hoje; com data (mesmo retroativa) = a que foi digitada
    date: date ? String(date) : todaySP(),
    categoryId: category_id ? Number(category_id) : null,
    paymentMethodId: payment_method_id ? Number(payment_method_id) : null,
  });

  res.redirect(`/dashboard?phone=${encodeURIComponent(phone)}`);
});

expensesRouter.get("/dashboard/expenses/:id/edit", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const expense = getExpenseById(phone, Number(req.params.id));
  if (!expense) return res.status(404).send("Gasto não encontrado.");

  const body = expenseForm({
    phone,
    action: `/dashboard/expenses/${expense.id}?phone=${encodeURIComponent(phone)}`,
    submitLabel: "Salvar",
    amount: expense.amount,
    description: expense.description,
    date: expense.date.slice(0, 10),
    categoryId: expense.category_id,
    paymentMethodId: expense.payment_method_id,
  });
  res.send(renderPage({ title: "Editar gasto", phone, active: "expenses", body }));
});

expensesRouter.post("/dashboard/expenses/:id", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const { amount, description, date, category_id, payment_method_id } = req.body;
  updateExpense(phone, Number(req.params.id), {
    amount: Number(amount),
    description: String(description || "").trim() || "Gasto",
    date: date ? String(date) : todaySP(),
    categoryId: category_id ? Number(category_id) : null,
    paymentMethodId: payment_method_id ? Number(payment_method_id) : null,
  });

  res.redirect(`/dashboard?phone=${encodeURIComponent(phone)}`);
});

expensesRouter.post("/dashboard/expenses/:id/delete", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  deleteExpense(phone, Number(req.params.id));
  res.redirect(`/dashboard?phone=${encodeURIComponent(phone)}`);
});
