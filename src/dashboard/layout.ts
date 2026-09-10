import { escapeHtml } from "./utils";

// Tags comuns de PWA (manifest, icone de tela inicial do iOS, cor da barra de
// status) -- repetidas nos dois shells de HTML (renderLoginPage e renderPage),
// ja que cada um monta seu proprio <head> do zero.
function pwaHeadTags(): string {
  return `<meta name="theme-color" content="#0a1122">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Organizaí">`;
}

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
    padding: 0 0 72px;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 24px 0; }

  .topbar {
    background: var(--card); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 20;
  }
  .topbar-inner {
    width: 100%; max-width: 1080px; margin: 0 auto; padding: 12px 24px;
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap; box-sizing: border-box;
  }
  .menu-toggle {
    display: none; order: 0; flex: none; width: 38px; height: 38px; align-items: center; justify-content: center;
    background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; color: var(--text);
    font-size: 1.05rem; line-height: 1; cursor: pointer; padding: 0;
  }
  .menu-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .topbar .brand { font-weight: 800; font-size: 1.02rem; white-space: nowrap; flex: none; order: 1; }
  .topbar nav.tabs { flex: 1; margin-bottom: 0; min-width: 0; order: 2; }
  .topbar-user { display: flex; align-items: center; gap: 14px; flex: none; margin-left: auto; order: 3; }
  .topbar-user .user-phone { font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .topbar-user form { margin: 0; }
  .topbar-user button {
    all: unset; font-size: 0.8rem; color: var(--muted); cursor: pointer; font-weight: 600;
  }
  .topbar-user button:hover { color: var(--accent); }

  nav.tabs {
    display: flex; gap: 8px; margin-bottom: 28px;
    overflow-x: auto; padding-bottom: 4px; scrollbar-width: none;
  }
  nav.tabs::-webkit-scrollbar { display: none; }
  nav.tabs a {
    flex: none; padding: 9px 16px; border-radius: 999px; text-decoration: none;
    font-size: 0.85rem; font-weight: 600; white-space: nowrap;
    background: var(--bg-soft); border: 1px solid var(--border); color: var(--muted);
    transition: color 0.15s, border-color 0.15s;
  }
  nav.tabs a.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  nav.tabs a:not(.active):hover { color: var(--text); border-color: #2e3d69; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 16px; margin-bottom: 18px;
  }
  h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
  .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
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
  .search-row { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
  .search-row input[type="text"] { flex: 1; min-width: 220px; }
  .bulk-bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
    background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px;
  }
  .bulk-bar select { flex: 1; min-width: 200px; }
  .bulk-select-all { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 0.84rem; white-space: nowrap; }
  table input[type="checkbox"], .bulk-select-all input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }

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

  .donut-wrap { display: flex; align-items: center; gap: 22px; }
  .donut { width: 120px; height: 120px; flex: none; }
  .donut-legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }
  .donut-legend-row { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; }
  .donut-legend .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .donut-legend-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .donut-legend-value { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }

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
    position: relative; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    min-height: 76px; padding: 6px; display: flex; flex-direction: column; gap: 3px;
  }
  .calendar-cell.empty { background: transparent; border-color: transparent; }
  .calendar-cell.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .calendar-cell.selected { background: var(--card-hover); border-color: var(--accent); }
  .calendar-cell:not(.empty):hover { border-color: #3a4a78; }
  .calendar-cell .day-fill {
    position: absolute; inset: 0; z-index: 0; border-radius: inherit;
  }
  .calendar-cell .day-num {
    position: relative; z-index: 1; pointer-events: none;
    display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; font-weight: 700; color: var(--muted);
  }
  .calendar-cell.today .day-num { color: var(--accent); }
  .calendar-cell.selected .day-num span {
    background: var(--accent); color: #fff; padding: 1px 6px; border-radius: 6px; margin: -1px -6px;
  }
  .calendar-cell .day-add {
    position: relative; z-index: 1; pointer-events: auto;
    color: var(--muted); text-decoration: none; font-size: 0.85rem; line-height: 1; padding: 0 2px;
  }
  .calendar-cell .day-add:hover { color: var(--accent); }
  .calendar-cell .ev {
    position: relative; z-index: 1;
    display: block; background: var(--accent-soft); color: #bcd3ff; text-decoration: none;
    font-size: 0.68rem; padding: 2px 5px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .calendar-cell .ev:hover { background: var(--accent); color: #fff; }
  .calendar-cell .ev-more { font-size: 0.66rem; color: var(--muted); padding: 0 5px; }

  @media (max-width: 600px) {
    body { padding: 0 0 56px; }
    .wrap { padding: 20px 14px 0; }
    .topbar-inner { padding: 10px 14px; gap: 10px; flex-wrap: nowrap; position: relative; }
    .topbar .brand { font-size: 0.94rem; }
    .topbar-user .user-phone { font-size: 0.72rem; }
    /* tela estreita: as 6 abas nao cabem numa barra so -- vira um botao de
       menu (hamburguer) que abre as abas como uma gaveta dropdown, em vez de
       rolar de lado (dificil de descobrir que da pra arrastar) */
    .menu-toggle { display: inline-flex; }
    .topbar nav.tabs {
      display: none; flex: none; position: absolute; left: 0; right: 0; top: 100%;
      flex-direction: column; gap: 4px; background: var(--card); border-bottom: 1px solid var(--border);
      padding: 10px 14px 14px; box-shadow: var(--shadow); overflow: visible;
    }
    .topbar nav.tabs.open { display: flex; }
    .topbar nav.tabs a { width: 100%; text-align: left; }
    h1 { font-size: 1.25rem; }
    .card .value { font-size: 1.3rem; }
    form.card-form { padding: 18px; }
    th, td { padding: 10px 12px; font-size: 0.82rem; }

    /* tabela de gastos (e outras marcadas com .mobile-cards) vira uma lista de
       cartoes em tela estreita, em vez de rolar de lado -- cada linha vira um
       bloco, cada celula mostra a coluna que representa (via data-label),
       igual um app mobile de verdade em vez de uma planilha espremida */
    .table-wrap table.mobile-cards { min-width: 0; }
    /* o "> tr" NAO funciona aqui: browser insere um <tbody> implicito em volta
       de <tr> soltos direto no <table> (nunca escrito no HTML), entao o
       filho direto de fato e o tbody, nao a tr -- selector descendente
       (sem ">") ignora essa camada extra e sempre acerta. */
    table.mobile-cards tr:first-child { display: none; } /* linha de cabecalho (sem thead nessa tabela) */
    table.mobile-cards tr {
      display: flex; flex-direction: column; padding: 12px 14px; border-bottom: 1px solid var(--border);
    }
    table.mobile-cards tr:last-child { border-bottom: none; }
    table.mobile-cards td {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 5px 0; border-bottom: none; font-size: 0.88rem;
    }
    table.mobile-cards td[data-label]::before {
      content: attr(data-label); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--muted); font-weight: 700; flex: none;
    }
    /* checkbox de selecao em lote e os links de editar/excluir sao "acoes",
       nao dado do gasto -- agrupados visualmente no fim do cartao (nao logo
       no topo, onde ficaria estranho por nao ter rotulo nenhum) */
    table.mobile-cards td.cell-check { order: 90; justify-content: flex-end; padding-top: 10px; }
    table.mobile-cards td.row-actions { order: 91; justify-content: flex-end; gap: 16px; padding-top: 4px; }
    table.mobile-cards td.empty { display: block; text-align: center; }

    /* celulas com um <form> inline dentro (ex: renomear categoria/forma de
       pagamento, editar orcamento) tem largura fixa no input (pensada pra
       desktop) -- em cartao mobile isso forcava rolagem de lado, entao aqui
       o rotulo vai pro topo e o form ocupa a largura toda do cartao. */
    table.mobile-cards td.cell-form { flex-direction: column; align-items: stretch; gap: 6px; }
    table.mobile-cards td.cell-form form { display: flex; gap: 8px; width: 100%; }
    table.mobile-cards td.cell-form input { flex: 1; min-width: 0; width: auto !important; }

    .donut-wrap { flex-direction: column; align-items: center; text-align: center; }
    .donut { width: 150px; height: 150px; }
    .donut-legend { width: 100%; }
    .donut-legend-name { text-align: left; }

    .calendar { gap: 3px; }
    .calendar-cell { min-height: 52px; padding: 3px; border-radius: 7px; }
    .calendar-cell .day-num { font-size: 0.68rem; }
    .calendar-cell .ev { display: none; }
    .calendar-cell.has-events { background: var(--accent-soft); }
  }
`;

// Mascara SEM o DDI "55" (o usuario so digita DDD + celular, 11 digitos --
// sempre no formato moderno com o "9" na frente); "55" e prefixado no server
// antes de normalizar/procurar a conta (ver src/dashboard/auth.ts).
const PHONE_MASK_SCRIPT = `
  function formatPhoneNoDDI(raw) {
    var digits = raw.replace(/\\D/g, "").slice(0, 11);
    var out = "";
    if (digits.length > 0) out += "(" + digits.slice(0, 2);
    if (digits.length >= 2) out += ")";
    if (digits.length > 2) out += " " + digits.slice(2, 3);
    if (digits.length > 3) out += " " + digits.slice(3, 7);
    if (digits.length > 7) out += "-" + digits.slice(7, 11);
    return out;
  }
  function attachPhoneMask(input, errorEl) {
    if (!input) return;
    input.addEventListener("input", function () {
      input.value = formatPhoneNoDDI(input.value);
      input.classList.remove("invalid");
      if (errorEl) errorEl.style.display = "none";
    });
    var form = input.closest("form");
    if (form) {
      form.addEventListener("submit", function (e) {
        var digitCount = input.value.replace(/\\D/g, "").length;
        if (digitCount !== 11) {
          e.preventDefault();
          input.classList.add("invalid");
          if (errorEl) errorEl.style.display = "block";
        }
      });
    }
  }
`;

export function renderLoginPage(opts: { error?: string; sent?: boolean } = {}): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Organizaí</title>
${pwaHeadTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a1122; --card:#131d38; --border:#223055; --text:#eaf0fb; --muted:#8b98bd; --accent:#2f6fee; --accent-hover:#4c85ff; --danger:#f0576b; --good:#34d399; }
  * { box-sizing: border-box; }
  body {
    font-family: "Manrope", -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(900px 480px at 20% -10%, rgba(47,111,238,0.18), transparent 60%), var(--bg);
    color: var(--text); max-width: 420px; margin: 0 auto; padding: 96px 20px; min-height: 100vh;
  }
  h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 12px; }
  p { color: var(--muted); font-size: 0.92rem; line-height: 1.5; }
  label { display: block; font-size: 0.8rem; color: var(--muted); margin: 14px 0 6px; font-weight: 600; }
  label:first-child { margin-top: 0; }
  form { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; margin-top: 20px; box-shadow: 0 12px 28px -12px rgba(0,0,0,0.55); }
  input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); font-size: 1rem; box-sizing: border-box; background: #0e1830; color: var(--text); font-family: inherit; }
  input:focus { outline: none; border-color: var(--accent); }
  input.invalid { border-color: var(--danger); }
  button { margin-top: 14px; width: 100%; padding: 12px 16px; border-radius: 999px; border: none; background: var(--accent); color: #fff; font-size: 0.95rem; font-weight: 700; cursor: pointer; font-family: inherit; }
  button:hover { background: var(--accent-hover); }
  button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
  p.hint { color: var(--muted); font-size: 0.8rem; margin-top: 20px; }
  p.error { color: var(--danger); font-size: 0.85rem; margin: 8px 0 0; }
  p.error.field { display: none; }
  p.banner { border-radius: 10px; padding: 10px 14px; font-size: 0.85rem; margin: 0 0 -8px; }
  p.banner.error { background: rgba(240, 87, 107, 0.14); border: 1px solid rgba(240, 87, 107, 0.35); }
  p.banner.success { background: rgba(52, 211, 153, 0.14); border: 1px solid rgba(52, 211, 153, 0.35); color: var(--good); }
  details.forgot { margin-top: 18px; }
  details.forgot summary { color: var(--muted); font-size: 0.85rem; cursor: pointer; }
  details.forgot summary:hover { color: var(--accent); }
</style></head>
<body>
<h1>Organizaí</h1>
<p>Entre com o número de WhatsApp e a senha que foi enviada por lá.</p>
${opts.error ? `<p class="banner error">${escapeHtml(opts.error)}</p>` : ""}
${opts.sent ? `<p class="banner success">Se esse número tiver acesso liberado, a senha foi enviada por WhatsApp. Pode levar alguns segundos.</p>` : ""}
<form method="post" action="/dashboard/login">
  <label for="phone">WhatsApp</label>
  <input name="phone" id="phone" placeholder="(99) 9 9999-9999" inputmode="numeric" autocomplete="username" autofocus required>
  <p class="error field" id="phone-error">Número incompleto — precisa do DDD e os 9 dígitos do celular.</p>
  <label for="password">Senha</label>
  <input name="password" id="password" type="text" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
</form>
<details class="forgot">
  <summary>Esqueci minha senha</summary>
  <form method="post" action="/dashboard/request-password">
    <label for="reset-phone">WhatsApp</label>
    <input name="phone" id="reset-phone" placeholder="(99) 9 9999-9999" inputmode="numeric" autocomplete="tel" required>
    <p class="error field" id="reset-phone-error">Número incompleto — precisa do DDD e os 9 dígitos do celular.</p>
    <button type="submit" class="secondary">Receber senha pelo WhatsApp</button>
  </form>
</details>
<script>${PHONE_MASK_SCRIPT}
  attachPhoneMask(document.getElementById("phone"), document.getElementById("phone-error"));
  attachPhoneMask(document.getElementById("reset-phone"), document.getElementById("reset-phone-error"));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});
</script>
</body></html>`;
}

// "556199210718" (formato canonico salvo, sem o "9" do meio -- e assim que o
// WhatsApp identifica numeros brasileiros) -> "(61) 99921-0718" pra exibicao
// humana, reinserindo o "9". So cosmetico -- nao afeta o valor usado pra
// consultar o banco (esse continua vindo puro da sessao).
function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!/^55\d{10}$/.test(digits)) return phone;
  const ddd = digits.slice(2, 4);
  const rest = digits.slice(4); // 8 digitos, sem o "9"
  return `(${ddd}) 9${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export function renderPage(opts: {
  title: string;
  phone: string;
  active: "expenses" | "incomes" | "categories" | "payments" | "events" | "reminders";
  body: string;
}): string {
  const tab = (href: string, key: string, label: string) => `<a href="${href}" class="${opts.active === key ? "active" : ""}">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
${pwaHeadTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <button type="button" class="menu-toggle" id="menu-toggle" aria-label="Abrir menu" aria-expanded="false">☰</button>
    <span class="brand">Organizaí</span>
    <div class="topbar-user">
      <span class="user-phone">${escapeHtml(formatPhoneForDisplay(opts.phone))}</span>
      <form method="post" action="/dashboard/logout"><button type="submit">Sair</button></form>
    </div>
    <nav class="tabs" id="tabs-nav">
      ${tab("/dashboard", "expenses", "Gastos")}
      ${tab("/dashboard/incomes", "incomes", "Entradas")}
      ${tab("/dashboard/categories", "categories", "Categorias")}
      ${tab("/dashboard/payment-methods", "payments", "Formas de pagamento")}
      ${tab("/dashboard/events", "events", "Agenda")}
      ${tab("/dashboard/reminders", "reminders", "Lembretes")}
    </nav>
  </div>
</header>
<div class="wrap">
  ${opts.body}
</div>
<script>
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});
  (function () {
    // menu hamburguer: so existe efeito visual em telas estreitas (a media
    // query e quem decide se o botao aparece e se nav.tabs vira dropdown) --
    // aqui so cuida de abrir/fechar, sem se preocupar com o tamanho da tela.
    var toggle = document.getElementById("menu-toggle");
    var nav = document.getElementById("tabs-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!nav.classList.contains("open")) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  })();
</script>
</body>
</html>`;
}
