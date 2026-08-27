import { escapeHtml } from "./utils";

const STYLE = `
  :root {
    --bg: #0a1122;
    --bg-soft: #0e1830;
    --card: #131d38;
    --card-hover: #182545;
    --border: #223055;
    --text: #eaf0fb;
    --muted: #8b98bd;
    --accent: #2f6fee;
    --accent-hover: #4c85ff;
    --accent-soft: rgba(47, 111, 238, 0.16);
    --good: #34d399;
    --good-soft: rgba(52, 211, 153, 0.14);
    --danger: #f0576b;
    --danger-soft: rgba(240, 87, 107, 0.14);
    --shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.55);
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Manrope", -apple-system, "Segoe UI", sans-serif;
    background:
      radial-gradient(1100px 500px at 15% -10%, rgba(47, 111, 238, 0.16), transparent 60%),
      var(--bg);
    color: var(--text);
    margin: 0;
    padding: 32px 24px 72px;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 1080px; margin: 0 auto; }

  nav.tabs {
    display: flex; gap: 8px; margin-bottom: 28px;
    overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;
  }
  nav.tabs::-webkit-scrollbar { display: none; }
  nav.tabs a {
    flex: none; padding: 9px 16px; border-radius: 999px; text-decoration: none;
    font-size: 0.85rem; font-weight: 600; white-space: nowrap;
    background: var(--card); border: 1px solid var(--border); color: var(--muted);
    transition: color 0.15s, border-color 0.15s;
  }
  nav.tabs a.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  nav.tabs a:not(.active):hover { color: var(--text); border-color: #2e3d69; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 16px; margin-bottom: 18px;
  }
  h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
  h2 { font-weight: 700; }

  .month-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 26px; }
  .month-nav a.arrow {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border-radius: 10px; flex: none;
    background: var(--card); border: 1px solid var(--border);
    color: var(--text); text-decoration: none; font-size: 1rem;
  }
  .month-nav a.arrow:hover { border-color: var(--accent); color: var(--accent); }
  .chip-row { display: flex; align-items: center; gap: 8px; margin-bottom: 26px; flex-wrap: wrap; }

  select, input {
    padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--card); color: var(--text); font-size: 0.9rem; font-family: inherit;
  }
  select:focus, input:focus { outline: none; border-color: var(--accent); }
  select { min-height: 40px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 26px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; box-shadow: var(--shadow); }
  .card .label { color: var(--muted); font-size: 0.78rem; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
  .card .value { font-size: 1.55rem; font-weight: 800; font-variant-numeric: tabular-nums; }

  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 26px; }
  @media (max-width: 700px) { .panels { grid-template-columns: 1fr; } }
  .panel { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; box-shadow: var(--shadow); }
  .panel h2 { font-size: 0.92rem; margin: 0 0 16px; color: var(--text); }
  .bar-row { display: grid; grid-template-columns: 96px 1fr 84px; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 0.84rem; }
  .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .bar-track { background: var(--bg-soft); border-radius: 6px; height: 9px; overflow: hidden; }
  .bar-fill { background: linear-gradient(90deg, var(--accent), var(--accent-hover)); height: 100%; border-radius: 6px; }
  .bar-value { text-align: right; color: var(--text); font-variant-numeric: tabular-nums; font-weight: 600; }

  .table-wrap {
    overflow-x: auto; border-radius: 14px; border: 1px solid var(--border);
    background: var(--card); box-shadow: var(--shadow); margin-bottom: 16px;
  }
  table { width: 100%; border-collapse: collapse; min-width: 560px; }
  th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.87rem; }
  th { color: var(--muted); font-weight: 700; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: var(--card-hover); }
  .amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  .tag { background: var(--accent-soft); color: #9cbcff; padding: 3px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 600; white-space: nowrap; }
  .empty { color: var(--muted); text-align: center; padding: 28px; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; padding: 10px 18px; border-radius: 999px; border: none;
    background: var(--accent); color: #fff; font-size: 0.88rem; cursor: pointer; text-decoration: none;
    white-space: nowrap; font-weight: 700; font-family: inherit; transition: background 0.15s, transform 0.1s;
  }
  .btn:hover { background: var(--accent-hover); }
  .btn:active { transform: scale(0.98); }
  .btn.secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); }
  .btn.secondary:hover { background: var(--card-hover); border-color: #2e3d69; }
  .btn.danger { background: var(--danger); }

  .link-action { color: var(--muted); text-decoration: none; font-size: 0.82rem; margin-right: 12px; font-weight: 600; }
  .link-action:hover { color: var(--accent); }

  form.card-form {
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    padding: 22px; max-width: 480px; box-shadow: var(--shadow);
  }
  form.card-form label { display: block; font-size: 0.8rem; color: var(--muted); margin: 16px 0 6px; font-weight: 600; }
  form.card-form label:first-child { margin-top: 0; }
  form.card-form input, form.card-form select { width: 100%; }
  form.card-form .actions { margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap; }
  form.card-form .actions .btn { flex: 1; }
  form.inline { display: inline; }
  .row-actions { white-space: nowrap; }

  .spotlight {
    background: linear-gradient(135deg, var(--accent-soft), transparent 70%), var(--card);
    border: 1px solid var(--border); border-left: 4px solid var(--accent);
    border-radius: 14px; padding: 18px 20px; margin-bottom: 26px; box-shadow: var(--shadow);
  }
  .spotlight h2 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 12px; }
  .spotlight-event { display: flex; align-items: baseline; gap: 10px; padding: 6px 0; font-size: 0.92rem; }
  .spotlight-event:not(:last-child) { border-bottom: 1px solid var(--border); }
  .spotlight-event .time { font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; flex: none; }
  .spotlight-event .title { flex: 1; }
  .spotlight-event a { text-decoration: none; color: inherit; }
  .spotlight-event a:hover .title { color: var(--accent); }

  .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 26px; }
  .calendar-weekday { text-align: center; font-size: 0.72rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; padding-bottom: 4px; }
  .calendar-cell {
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    min-height: 76px; padding: 6px; display: flex; flex-direction: column; gap: 3px;
  }
  .calendar-cell.empty { background: transparent; border-color: transparent; }
  .calendar-cell.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .calendar-cell.selected { background: var(--card-hover); border-color: var(--accent); }
  .calendar-cell .day-num { display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; font-weight: 700; color: var(--muted); }
  .calendar-cell.today .day-num { color: var(--accent); }
  .calendar-cell .day-select {
    color: inherit; text-decoration: none; padding: 1px 5px; border-radius: 6px; margin: -1px -5px;
  }
  .calendar-cell .day-select:hover { background: var(--accent-soft); color: var(--accent); }
  .calendar-cell.selected .day-select { background: var(--accent); color: #fff; }
  .calendar-cell .day-add { color: var(--muted); text-decoration: none; font-size: 0.85rem; line-height: 1; padding: 0 2px; }
  .calendar-cell .day-add:hover { color: var(--accent); }
  .calendar-cell .ev {
    display: block; background: var(--accent-soft); color: #bcd3ff; text-decoration: none;
    font-size: 0.68rem; padding: 2px 5px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .calendar-cell .ev:hover { background: var(--accent); color: #fff; }
  .calendar-cell .ev-more { font-size: 0.66rem; color: var(--muted); padding: 0 5px; }

  @media (max-width: 600px) {
    body { padding: 20px 14px 56px; }
    h1 { font-size: 1.25rem; }
    .card .value { font-size: 1.3rem; }
    form.card-form { padding: 18px; }
    th, td { padding: 10px 12px; font-size: 0.82rem; }
    .calendar { gap: 3px; }
    .calendar-cell { min-height: 52px; padding: 3px; border-radius: 7px; }
    .calendar-cell .day-num { font-size: 0.68rem; }
    .calendar-cell .ev { display: none; }
    .calendar-cell.has-events { background: var(--accent-soft); }
  }
`;

export function renderPhoneGate(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gastos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a1122; --card:#131d38; --border:#223055; --text:#eaf0fb; --muted:#8b98bd; --accent:#2f6fee; --accent-hover:#4c85ff; --danger:#f0576b; }
  * { box-sizing: border-box; }
  body {
    font-family: "Manrope", -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(900px 480px at 20% -10%, rgba(47,111,238,0.18), transparent 60%), var(--bg);
    color: var(--text); max-width: 420px; margin: 0 auto; padding: 96px 20px; min-height: 100vh;
  }
  h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 12px; }
  p { color: var(--muted); font-size: 0.92rem; line-height: 1.5; }
  form { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 28px -12px rgba(0,0,0,0.55); }
  input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); font-size: 1rem; box-sizing: border-box; background: #0e1830; color: var(--text); font-family: inherit; }
  input:focus { outline: none; border-color: var(--accent); }
  input.invalid { border-color: var(--danger); }
  button { margin-top: 14px; width: 100%; padding: 12px 16px; border-radius: 999px; border: none; background: var(--accent); color: #fff; font-size: 0.95rem; font-weight: 700; cursor: pointer; font-family: inherit; }
  button:hover { background: var(--accent-hover); }
  p.hint { color: var(--muted); font-size: 0.8rem; margin-top: 20px; }
  p.error { color: var(--danger); font-size: 0.85rem; margin: 8px 0 0; display: none; }
</style></head>
<body>
<h1>Gastos</h1>
<p>Digite o número de WhatsApp (o mesmo que manda mensagem pro bot) pra ver e gerenciar os gastos dele.</p>
<form id="phone-form" method="get" action="/dashboard">
  <input name="phone" id="phone-input" placeholder="55 (61) 99921-0718" inputmode="numeric" autocomplete="off" autofocus required>
  <p class="error" id="phone-error">Número incompleto — precisa do DDI (55), DDD e os 9 dígitos do celular.</p>
  <button type="submit" id="phone-submit">Ver gastos</button>
</form>
<p class="hint">Isso não é um login de verdade — qualquer um com o link e o número certo acessa. Pra virar produto de vários clientes, essa parte precisa de autenticação real.</p>
<script>
  (function () {
    var input = document.getElementById("phone-input");
    var error = document.getElementById("phone-error");
    var form = document.getElementById("phone-form");

    function formatPhone(raw) {
      var digits = raw.replace(/\\D/g, "").slice(0, 13);
      var out = digits.slice(0, 2);
      if (digits.length > 2) out += " (" + digits.slice(2, 4);
      if (digits.length >= 4) out += ")";
      if (digits.length > 4) out += " " + digits.slice(4, 9);
      if (digits.length > 9) out += "-" + digits.slice(9, 13);
      return out;
    }

    input.addEventListener("input", function () {
      input.value = formatPhone(input.value);
      input.classList.remove("invalid");
      error.style.display = "none";
    });

    form.addEventListener("submit", function (e) {
      var digitCount = input.value.replace(/\\D/g, "").length;
      if (digitCount !== 13) {
        e.preventDefault();
        input.classList.add("invalid");
        error.style.display = "block";
      }
    });
  })();
</script>
</body></html>`;
}

export function renderPage(opts: {
  title: string;
  phone: string;
  active: "expenses" | "categories" | "payments" | "events" | "reminders";
  body: string;
}): string {
  const phoneQS = `phone=${encodeURIComponent(opts.phone)}`;
  const tab = (href: string, key: string, label: string) =>
    `<a href="${href}?${phoneQS}" class="${opts.active === key ? "active" : ""}">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <nav class="tabs">
    ${tab("/dashboard", "expenses", "Gastos")}
    ${tab("/dashboard/categories", "categories", "Categorias")}
    ${tab("/dashboard/payment-methods", "payments", "Formas de pagamento")}
    ${tab("/dashboard/events", "events", "Agenda")}
    ${tab("/dashboard/reminders", "reminders", "Lembretes")}
  </nav>
  ${opts.body}
</div>
</body>
</html>`;
}
