import { escapeHtml } from "./utils";

const STYLE = `
  :root {
    --accent: #16a34a;
    --accent-soft: #dcfce7;
    --danger: #dc2626;
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
  a { color: inherit; }
  .wrap { max-width: 1000px; margin: 0 auto; }
  nav.tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  nav.tabs a {
    padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 0.88rem;
    background: var(--card); border: 1px solid var(--border); color: var(--text);
  }
  nav.tabs a.active { background: var(--text); color: #fff; border-color: var(--text); }
  header {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 16px; margin-bottom: 16px;
  }
  h1 { font-size: 1.5rem; margin: 0; }
  .month-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
  .month-nav a {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 8px;
    background: var(--card); border: 1px solid var(--border);
    color: var(--text); text-decoration: none; font-size: 1rem;
  }
  select, input {
    padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--card); color: var(--text); font-size: 0.9rem;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
  .card .label { color: var(--muted); font-size: 0.82rem; margin-bottom: 6px; }
  .card .value { font-size: 1.5rem; font-weight: 600; }
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  @media (max-width: 700px) { .panels { grid-template-columns: 1fr; } }
  .panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
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
  .btn {
    display: inline-flex; align-items: center; padding: 9px 16px; border-radius: 8px; border: none;
    background: var(--accent); color: #fff; font-size: 0.9rem; cursor: pointer; text-decoration: none;
    white-space: nowrap; font-weight: 500;
  }
  .btn.secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); }
  .btn.danger { background: var(--danger); }
  .link-action { color: var(--muted); text-decoration: none; font-size: 0.82rem; margin-right: 10px; }
  .link-action:hover { color: var(--text); }
  form.card-form { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; max-width: 480px; }
  form.card-form label { display: block; font-size: 0.82rem; color: var(--muted); margin: 14px 0 4px; }
  form.card-form label:first-child { margin-top: 0; }
  form.card-form input, form.card-form select { width: 100%; }
  form.card-form .actions { margin-top: 20px; display: flex; gap: 10px; }
  form.inline { display: inline; }
  .row-actions { white-space: nowrap; }
`;

export function renderPhoneGate(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Gastos</title>
<style>body{font-family:-apple-system,"Segoe UI",system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 16px;color:#1f2937}
input{width:100%;padding:10px;border-radius:8px;border:1px solid #e5e7eb;font-size:1rem;box-sizing:border-box}
button{margin-top:12px;padding:10px 16px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-size:1rem;cursor:pointer}
p.hint{color:#6b7280;font-size:0.85rem}</style></head>
<body>
<h1>Gastos</h1>
<p>Digite o número de WhatsApp (o mesmo que manda mensagem pro bot) pra ver e gerenciar os gastos dele.</p>
<form method="get" action="/dashboard"><input name="phone" placeholder="Ex: 5561999999999" autofocus><button type="submit">Ver gastos</button></form>
<p class="hint">Isso não é um login de verdade — qualquer um com o link e o número certo acessa. Pra virar produto de vários clientes, essa parte precisa de autenticação real.</p>
</body></html>`;
}

export function renderPage(opts: { title: string; phone: string; active: "expenses" | "categories" | "payments"; body: string }): string {
  const phoneQS = `phone=${encodeURIComponent(opts.phone)}`;
  const tab = (href: string, key: string, label: string) =>
    `<a href="${href}?${phoneQS}" class="${opts.active === key ? "active" : ""}">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <nav class="tabs">
    ${tab("/dashboard", "expenses", "Gastos")}
    ${tab("/dashboard/categories", "categories", "Categorias")}
    ${tab("/dashboard/payment-methods", "payments", "Formas de pagamento")}
  </nav>
  ${opts.body}
</div>
</body>
</html>`;
}
