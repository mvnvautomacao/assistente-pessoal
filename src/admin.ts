import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { getRecentActivity, getPendingReminders, getRecentBlockedAttempts } from "./activity/service";
import { listAllowedNumbers, allowNumber, revokeNumber } from "./access/allowlist";
import { normalizeBrazilPhone } from "./dashboard/utils";
import { config } from "./config";
import { createSession, getSession, destroySession, ADMIN_SESSION_TTL_MS } from "./auth/session";
import { isLoginLocked, recordFailedLogin, recordSuccessfulLogin } from "./auth/loginGuard";
import { listDashboardAccounts, deleteDashboardAccount } from "./dashboard/accounts";
import { maybeSendNewPassword } from "./dashboard/auth";
import { PAGE_SIZES, paginate } from "./dashboard/utils";
import { destroyDashboardSessionsForPhone } from "./auth/session";

export const adminRouter = Router();

export const ADMIN_SESSION_COOKIE = "organizai_admin_session";

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // comprimentos diferentes vazariam informacao pelo tempo de resposta se so
  // chamassemos timingSafeEqual (que exige buffers do mesmo tamanho) -- aqui
  // preenchemos o menor com Buffer.alloc do mesmo tamanho do maior, entao a
  // comparacao sempre roda no mesmo "shape" independente do que foi digitado.
  const length = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

function adminCookieOptions(req: Request) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  return { httpOnly: true, secure: isHttps, sameSite: "lax" as const, maxAge: ADMIN_SESSION_TTL_MS };
}

function renderAdminLoginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Organizaí</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 360px; margin: 96px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 1.3rem; }
  form { border: 1px solid #ddd; border-radius: 10px; padding: 20px; margin-top: 16px; }
  label { display: block; font-size: 0.85rem; color: #555; margin: 12px 0 4px; }
  label:first-child { margin-top: 0; }
  input { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid #ccc; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 14px; width: 100%; padding: 10px 14px; border-radius: 6px; border: none; background: #222; color: #fff; font-size: 0.95rem; cursor: pointer; }
  p.error { color: #c0392b; font-size: 0.85rem; }
</style></head>
<body>
<h1>Admin</h1>
${error ? `<p class="error">${error}</p>` : ""}
<form method="post" action="/admin/login">
  <label for="username">Usuário</label>
  <input name="username" id="username" autocomplete="off" autofocus required>
  <label for="password">Senha</label>
  <input name="password" id="password" type="password" required>
  <button type="submit">Entrar</button>
</form>
</body></html>`;
}

adminRouter.post("/admin/login", (req, res) => {
  // prefixo "admin:" pra nao compartilhar contador com o login do dashboard
  // (mesmo IP, credenciais completamente diferentes -- um brute-force ali nao
  // devia travar o outro, ver src/dashboard/auth.ts).
  const key = `admin:${req.ip ?? "unknown"}`;
  if (isLoginLocked(key)) {
    res.status(429).send(renderAdminLoginPage("Muitas tentativas erradas. Tenta de novo em alguns minutos."));
    return;
  }
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const ok = timingSafeStringEqual(username, config.admin.username) && timingSafeStringEqual(password, config.admin.password);
  if (!ok) {
    recordFailedLogin(key);
    res.status(401).send(renderAdminLoginPage("Usuário ou senha incorretos."));
    return;
  }
  recordSuccessfulLogin(key);
  const token = createSession({ type: "admin" }, ADMIN_SESSION_TTL_MS);
  res.cookie(ADMIN_SESSION_COOKIE, token, adminCookieOptions(req));
  res.redirect("/admin");
});

adminRouter.post("/admin/logout", (req, res) => {
  destroySession(req.cookies?.[ADMIN_SESSION_COOKIE]);
  res.clearCookie(ADMIN_SESSION_COOKIE);
  res.redirect("/admin");
});

function requireAdminSession(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req.cookies?.[ADMIN_SESSION_COOKIE]);
  if (!session || session.type !== "admin") {
    res.send(renderAdminLoginPage());
    return;
  }
  next();
}

// IMPORTANTE: com path -- adminRouter e montado na raiz do app (nao com um
// prefixo "/admin"), entao um .use(fn) SEM path aqui interceptaria QUALQUER
// rota que passasse por esse router (ex: /dashboard), nao so as de admin.
adminRouter.use("/admin", requireAdminSession);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// Paginacao achado da auditoria ("/admin sem paginação: atividade recente e
// tentativas bloqueadas mostram sempre os últimos 50"). Reaproveita PAGE_SIZES
// e paginate() do dashboard, mas com nomes de parametro PREFIXADOS (ex:
// "activity_page") -- as duas listas ficam na MESMA pagina, entao paginar uma
// nao pode resetar a outra, e cada form de paginacao carrega o estado atual
// da OUTRA lista como campo escondido pra preservar ao trocar de pagina.
function parsePrefixedPagination(query: Record<string, unknown>, prefix: string): { page: number; perPage: number } {
  const rawPerPage = Number(query[`${prefix}_per_page`]);
  const perPage = PAGE_SIZES.includes(rawPerPage) ? rawPerPage : 10;
  const rawPage = Number(query[`${prefix}_page`]);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { page, perPage };
}

function renderAdminPagination(opts: { prefix: string; page: number; perPage: number; total: number; preserve: Record<string, string> }): string {
  if (opts.total <= 10) return "";
  const totalPages = Math.max(1, Math.ceil(opts.total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page), totalPages);
  const linkFor = (p: number) =>
    `/admin?${new URLSearchParams({ ...opts.preserve, [`${opts.prefix}_page`]: String(p), [`${opts.prefix}_per_page`]: String(opts.perPage) })}#${opts.prefix}`;
  const hiddenInputs = Object.entries(opts.preserve)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  const sizeOptions = PAGE_SIZES.map((n) => `<option value="${n}" ${n === opts.perPage ? "selected" : ""}>${n}</option>`).join("");

  return `
  <div style="display:flex;align-items:center;gap:12px;margin-top:8px;font-size:0.85rem;color:#555;flex-wrap:wrap">
    <form method="get" action="/admin#${opts.prefix}" class="inline" style="display:inline-flex;align-items:center;gap:6px">
      ${hiddenInputs}
      <input type="hidden" name="${opts.prefix}_page" value="1">
      <label for="${opts.prefix}_per_page">Mostrar</label>
      <select name="${opts.prefix}_per_page" id="${opts.prefix}_per_page" onchange="this.form.submit()">${sizeOptions}</select>
      <span>por página</span>
    </form>
    <span>
      ${page <= 1 ? `<span style="opacity:.4">‹ Anterior</span>` : `<a href="${linkFor(page - 1)}">‹ Anterior</a>`}
      &nbsp;·&nbsp;Página ${page} de ${totalPages} (${opts.total})&nbsp;·&nbsp;
      ${page >= totalPages ? `<span style="opacity:.4">Próxima ›</span>` : `<a href="${linkFor(page + 1)}">Próxima ›</a>`}
    </span>
  </div>`;
}

const TYPE_LABEL: Record<string, string> = {
  expense: "💰 Gasto",
  event: "📅 Evento",
  delete_event: "🗑️ Evento cancelado",
  edit_event: "✏️ Evento remarcado",
  edit_reminder: "✏️ Lembrete remarcado",
  report: "📊 Relatório",
  correct_category: "✏️ Categoria corrigida",
  set_default_payment: "💳 Pagamento padrão",
  expense_report: "💰 Resumo de gastos",
  set_report_day: "📆 Dia do relatório",
  set_budget: "🎯 Orçamento definido",
  remove_budget: "🎯 Orçamento removido",
  list_budgets: "📋 Lista de orçamentos",
  list_categories: "🏷️ Lista de categorias",
  create_category: "🏷️ Categoria criada",
  bulk_recategorize: "🏷️ Recategorização em lote",
  merge_categories: "🏷️ Categorias unidas",
  delete_category: "🏷️ Categoria apagada",
  welcome: "👋 Boas-vindas (número novo)",
  help: "🤖 Explicou funcionalidades",
  list_expenses: "🧾 Lista de gastos",
  edit_expense: "✏️ Gasto editado",
  reminder: "⏰ Lembrete",
  undo: "↩️ Desfeito",
  set_recurring_expense: "🔁 Gasto fixo cadastrado",
  list_recurring_expenses: "🔁 Lista de gastos fixos",
  remove_recurring_expense: "🔁 Gasto fixo removido",
  recurring_expense: "🔁 Gasto fixo lançado",
  income: "💵 Entrada",
  income_report: "💵 Resumo de entradas",
  balance: "📊 Saldo consultado",
  unknown: "❓ Não entendido",
  error: "⚠️ Erro",
  blocked: "🚫 Bloqueado (número não autorizado)",
};

adminRouter.get("/admin", (req, res) => {
  // busca um lote generoso (nao so os ultimos 50) e pagina em memoria, mesmo
  // padrao ja usado nas listas do dashboard -- as duas secoes tem paginacao
  // INDEPENDENTE (parametros prefixados), ja que ficam na mesma pagina.
  const activityPagination = parsePrefixedPagination(req.query, "activity");
  const blockedPagination = parsePrefixedPagination(req.query, "blocked");

  const allActivity = getRecentActivity(500);
  const activity = paginate(allActivity, activityPagination.page, activityPagination.perPage);
  const pendingReminders = getPendingReminders(50);
  const allowed = listAllowedNumbers();
  const allowedSet = new Set(allowed.map((a) => a.from_number));
  const allBlockedAttempts = getRecentBlockedAttempts(500).filter((b) => !allowedSet.has(b.from_number));
  const blockedAttempts = paginate(allBlockedAttempts, blockedPagination.page, blockedPagination.perPage);
  const dashboardAccounts = listDashboardAccounts();

  const activityRows = activity
    .map(
      (a) =>
        `<tr><td>${formatDate(a.created_at)}</td><td>${TYPE_LABEL[a.type] ?? a.type}</td><td>${escapeHtml(a.from_number)}</td><td>${escapeHtml(a.summary)}</td></tr>`
    )
    .join("");

  const reminderRows = pendingReminders
    .map((r) => `<tr><td>${formatDate(r.due_at)}</td><td>${escapeHtml(r.to_number)}</td><td>${escapeHtml(r.message)}</td></tr>`)
    .join("");

  const allowedRows = allowed
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.from_number)}</td>
        <td>${escapeHtml(a.note ?? "—")}</td>
        <td>${formatDate(a.added_at)}</td>
        <td>
          <form class="inline" method="post" action="/admin/allowlist/remove" onsubmit="return confirm('Bloquear esse número de novo?')">
            <input type="hidden" name="from_number" value="${escapeHtml(a.from_number)}">
            <button type="submit" class="link-btn danger">Remover</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const blockedRows = blockedAttempts
    .map(
      (b) => `
      <tr>
        <td>${formatDate(b.created_at)}</td>
        <td>${escapeHtml(b.from_number)}</td>
        <td>${escapeHtml(b.summary)}</td>
        <td>
          <form class="inline" method="post" action="/admin/allowlist/add">
            <input type="hidden" name="from_number" value="${escapeHtml(b.from_number)}">
            <input type="hidden" name="raw" value="1">
            <button type="submit" class="link-btn">Aprovar</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const dashboardAccountRows = dashboardAccounts
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.phone_number)}</td>
        <td>${formatDate(a.created_at)}</td>
        <td>${a.last_password_sent_at ? formatDate(a.last_password_sent_at) : "—"}</td>
        <td>
          <form class="inline" method="post" action="/admin/dashboard-accounts/reset" onsubmit="return confirm('Gerar e mandar uma senha nova pro WhatsApp desse número?')">
            <input type="hidden" name="phone_number" value="${escapeHtml(a.phone_number)}">
            <button type="submit" class="link-btn">Redefinir senha</button>
          </form>
          <form class="inline" method="post" action="/admin/dashboard-accounts/revoke" onsubmit="return confirm('Tirar o acesso desse número ao painel? Ele continua podendo falar com o assistente pelo WhatsApp normalmente -- so o login do painel para de funcionar, ate pedir senha de novo.')">
            <input type="hidden" name="phone_number" value="${escapeHtml(a.phone_number)}">
            <button type="submit" class="link-btn danger">Tirar acesso</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Assistente Pessoal — Admin</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e5e5; font-size: 0.9rem; }
  th { color: #666; font-weight: 600; }
  .empty { color: #999; padding: 12px 0; }
  .inline { display: inline; margin: 0; }
  .link-btn { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 0.85rem; }
  .link-btn.danger { border-color: #e08080; color: #c0392b; }
  .add-form { display: flex; gap: 8px; margin-top: 0.75rem; flex-wrap: wrap; }
  .add-form input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.9rem; }
  .add-form button { padding: 6px 12px; border-radius: 6px; border: 1px solid #333; background: #222; color: #fff; cursor: pointer; }
  .warn { background: #fff4e5; border: 1px solid #f0c987; border-radius: 8px; padding: 10px 14px; font-size: 0.88rem; margin-top: 0.5rem; }
</style>
</head>
<body>
<form class="inline" method="post" action="/admin/logout" style="float:right"><button type="submit" class="link-btn">Sair</button></form>
<h1>Assistente Pessoal</h1>

<h2>Contas do painel (${dashboardAccounts.length})</h2>
<p class="warn">Senha sempre gerada pelo sistema e mandada por WhatsApp — nunca digitada aqui. "Redefinir senha" manda uma nova na hora, sem esperar o limite de 1h que vale pro autoatendimento.</p>
${dashboardAccounts.length ? `<table><tr><th>Número</th><th>Criada em</th><th>Última senha enviada</th><th></th></tr>${dashboardAccountRows}</table>` : `<p class="empty">Nenhuma conta criada ainda.</p>`}
<form class="add-form" method="post" action="/admin/dashboard-accounts/reset">
  <input type="text" name="phone_number" placeholder="Ex: 5561999210718" required>
  <button type="submit">Mandar senha</button>
</form>

<h2>Números autorizados (${allowed.length})</h2>
<p class="warn">Só quem está nessa lista recebe resposta do assistente. Qualquer outro número é ignorado em silêncio (nada é respondido) — isso evita o bot ficar respondendo sem parar pra outro bot.</p>
${allowed.length ? `<table><tr><th>Número</th><th>Nota</th><th>Autorizado em</th><th></th></tr>${allowedRows}</table>` : `<p class="empty">Nenhum número autorizado ainda.</p>`}
<form class="add-form" method="post" action="/admin/allowlist/add">
  <input type="text" name="from_number" placeholder="Ex: 5561999210718" required>
  <input type="text" name="note" placeholder="Nota (opcional)">
  <button type="submit">+ Autorizar número</button>
</form>

<h2 id="blocked">Tentativas bloqueadas recentemente (${allBlockedAttempts.length})</h2>
${allBlockedAttempts.length ? `<table><tr><th>Quando</th><th>Número</th><th>Mensagem</th><th></th></tr>${blockedRows}</table>` : `<p class="empty">Nenhuma tentativa bloqueada recentemente.</p>`}
${renderAdminPagination({
  prefix: "blocked",
  page: blockedPagination.page,
  perPage: blockedPagination.perPage,
  total: allBlockedAttempts.length,
  preserve: { activity_page: String(activityPagination.page), activity_per_page: String(activityPagination.perPage) },
})}

<h2>Lembretes pendentes (${pendingReminders.length})</h2>
${pendingReminders.length ? `<table><tr><th>Quando</th><th>Para</th><th>Mensagem</th></tr>${reminderRows}</table>` : `<p class="empty">Nenhum lembrete pendente.</p>`}

<h2 id="activity">Atividade recente (${allActivity.length})</h2>
${allActivity.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>De</th><th>Resumo</th></tr>${activityRows}</table>` : `<p class="empty">Nenhuma atividade registrada ainda.</p>`}
${renderAdminPagination({
  prefix: "activity",
  page: activityPagination.page,
  perPage: activityPagination.perPage,
  total: allActivity.length,
  preserve: { blocked_page: String(blockedPagination.page), blocked_per_page: String(blockedPagination.perPage) },
})}

</body>
</html>`);
});

adminRouter.post("/admin/allowlist/add", (req, res) => {
  // "Aprovar" num bloqueado recente manda raw=1: o from_number ja e EXATAMENTE o
  // que veio do WhatsApp (mesmo formato salvo em toda mensagem futura desse
  // numero) -- normalizar aqui poderia corromper um numero que legitimamente tem
  // 13 digitos, fazendo ele nunca mais bater com as mensagens reais desse contato.
  // Ja o formulario de digitar a mao pode vir com o "9" extra que o BR costuma
  // escrever, entao so nesse caso normaliza igual o dashboard faz.
  const raw = req.body.raw === "1";
  const fromNumber = raw
    ? String(req.body.from_number || "").replace(/\D/g, "")
    : normalizeBrazilPhone(String(req.body.from_number || ""));
  if (fromNumber) allowNumber(fromNumber, req.body.note ? String(req.body.note).trim() : undefined);
  res.redirect("/admin");
});

adminRouter.post("/admin/allowlist/remove", (req, res) => {
  const fromNumber = String(req.body.from_number || "");
  if (fromNumber) revokeNumber(fromNumber);
  res.redirect("/admin");
});

adminRouter.post("/admin/dashboard-accounts/reset", async (req, res) => {
  const phoneNumber = String(req.body.phone_number || "");
  if (phoneNumber) await maybeSendNewPassword(phoneNumber, { bypassCooldown: true });
  res.redirect("/admin");
});

adminRouter.post("/admin/dashboard-accounts/revoke", (req, res) => {
  const phoneNumber = String(req.body.phone_number || "");
  if (phoneNumber) {
    deleteDashboardAccount(phoneNumber);
    destroyDashboardSessionsForPhone(phoneNumber);
  }
  res.redirect("/admin");
});
