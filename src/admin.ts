import { Router } from "express";
import { getRecentActivity, getPendingReminders } from "./activity/service";

export const adminRouter = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const TYPE_LABEL: Record<string, string> = {
  expense: "💰 Gasto",
  event: "📅 Evento",
  delete_event: "🗑️ Evento cancelado",
  report: "📊 Relatório",
  reminder: "⏰ Lembrete",
  unknown: "❓ Não entendido",
  error: "⚠️ Erro",
};

adminRouter.get("/admin", (_req, res) => {
  const activity = getRecentActivity(50);
  const pendingReminders = getPendingReminders(50);

  const activityRows = activity
    .map(
      (a) =>
        `<tr><td>${formatDate(a.created_at)}</td><td>${TYPE_LABEL[a.type] ?? a.type}</td><td>${escapeHtml(a.from_number)}</td><td>${escapeHtml(a.summary)}</td></tr>`
    )
    .join("");

  const reminderRows = pendingReminders
    .map((r) => `<tr><td>${formatDate(r.due_at)}</td><td>${escapeHtml(r.to_number)}</td><td>${escapeHtml(r.message)}</td></tr>`)
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
</style>
</head>
<body>
<h1>Assistente Pessoal</h1>

<h2>Lembretes pendentes (${pendingReminders.length})</h2>
${pendingReminders.length ? `<table><tr><th>Quando</th><th>Para</th><th>Mensagem</th></tr>${reminderRows}</table>` : `<p class="empty">Nenhum lembrete pendente.</p>`}

<h2>Atividade recente (${activity.length})</h2>
${activity.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>De</th><th>Resumo</th></tr>${activityRows}</table>` : `<p class="empty">Nenhuma atividade registrada ainda.</p>`}

</body>
</html>`);
});
