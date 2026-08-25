import { Router } from "express";
import {
  getExpensesForMonth,
  getCategoryTotalsForMonth,
  getPaymentMethodTotalsForMonth,
  getAvailableMonths,
} from "./expenses/service";

export const dashboardRouter = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

dashboardRouter.get("/dashboard", (req, res) => {
  const months = getAvailableMonths();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : months[0] ?? currentMonth;

  const expenses = getExpensesForMonth(month);
  const categoryTotals = getCategoryTotalsForMonth(month).map((c) => ({ name: c.name, total: c.total }));
  const paymentTotals = getPaymentMethodTotalsForMonth(month).map((p) => ({ name: p.name, total: p.total }));
  const monthTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const topCategory = categoryTotals[0]?.name ?? "—";

  const monthOptions = months.length
    ? months.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")
    : `<option value="${month}" selected>${escapeHtml(monthLabel(month))}</option>`;

  const expenseRows = expenses.length
    ? expenses
        .map(
          (e) => `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td><span class="tag">${escapeHtml(e.category ?? "Sem categoria")}</span></td>
        <td>${escapeHtml(e.payment_method ?? "—")}</td>
        <td class="amount">${formatMoney(e.amount)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty">Nenhum gasto registrado neste mês.</td></tr>`;

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gastos — ${escapeHtml(monthLabel(month))}</title>
<style>
  :root {
    --accent: #16a34a;
    --accent-soft: #dcfce7;
    --bg: #f6f7f9;
    --card: #ffffff;
    --border: #e5e7eb;
    --text: #1f2937;
    --muted: #6b7280;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 32px 24px 64px;
  }
  .wrap { max-width: 1000px; margin: 0 auto; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 24px;
  }
  h1 { font-size: 1.5rem; margin: 0; }
  .month-nav { display: flex; align-items: center; gap: 8px; }
  .month-nav a {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 8px;
    background: var(--card); border: 1px solid var(--border);
    color: var(--text); text-decoration: none; font-size: 1rem;
  }
  select {
    padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--card); color: var(--text); font-size: 0.9rem;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 18px 20px;
  }
  .card .label { color: var(--muted); font-size: 0.82rem; margin-bottom: 6px; }
  .card .value { font-size: 1.5rem; font-weight: 600; }
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  @media (max-width: 700px) { .panels { grid-template-columns: 1fr; } }
  .panel {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;
  }
  .panel h2 { font-size: 0.95rem; margin: 0 0 14px; color: var(--text); }
  .bar-row { display: grid; grid-template-columns: 100px 1fr 90px; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 0.85rem; }
  .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { background: var(--bg); border-radius: 6px; height: 10px; overflow: hidden; }
  .bar-fill { background: var(--accent); height: 100%; border-radius: 6px; }
  .bar-value { text-align: right; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
  th { color: var(--muted); font-weight: 600; background: #fafafa; }
  tr:last-child td { border-bottom: none; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { background: var(--accent-soft); color: #166534; padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; }
  .empty { color: var(--muted); text-align: center; padding: 20px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(monthLabel(month))}</h1>
    <div class="month-nav">
      <a href="/dashboard?month=${shiftMonth(month, -1)}">‹</a>
      <form method="get" style="margin:0">
        <select name="month" onchange="this.form.submit()">${monthOptions}</select>
      </form>
      <a href="/dashboard?month=${shiftMonth(month, 1)}">›</a>
    </div>
  </header>

  <div class="cards">
    <div class="card"><div class="label">Total do mês</div><div class="value">${formatMoney(monthTotal)}</div></div>
    <div class="card"><div class="label">Maior categoria</div><div class="value">${escapeHtml(topCategory)}</div></div>
    <div class="card"><div class="label">Nº de gastos</div><div class="value">${expenses.length}</div></div>
  </div>

  <div class="panels">
    <div class="panel">
      <h2>Por categoria</h2>
      ${barList(categoryTotals)}
    </div>
    <div class="panel">
      <h2>Por forma de pagamento</h2>
      ${barList(paymentTotals)}
    </div>
  </div>

  <table>
    <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th style="text-align:right">Valor</th></tr>
    ${expenseRows}
  </table>
</div>
</body>
</html>`);
});
