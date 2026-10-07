import { Router } from "express";
import { escapeHtml } from "./dashboard/utils";
import { spDateString } from "./timeSP";
import {
  CARD_STATUSES,
  CARD_STATUS_LABEL,
  CARD_TYPES,
  CARD_TYPE_LABEL,
  SprintCard,
  addCard,
  closeActiveSprintAndStartNext,
  daysLeft,
  deleteCard,
  ensureActiveSprint,
  isCardStatus,
  isCardType,
  listCards,
  listSprints,
  moveCard,
  setSprintEndDate,
  updateCard,
} from "./sprints/service";

function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

const TYPE_COLOR: Record<string, string> = { melhoria: "#2f6fee", evolucao: "#8b5cf6", incidente: "#e0524f" };

function renderCard(card: SprintCard): string {
  const statusIdx = CARD_STATUSES.indexOf(card.status);
  const prev = statusIdx > 0 ? CARD_STATUSES[statusIdx - 1] : null;
  const next = statusIdx < CARD_STATUSES.length - 1 ? CARD_STATUSES[statusIdx + 1] : null;
  const moveBtn = (to: (typeof CARD_STATUSES)[number] | null, label: string) =>
    to
      ? `<form class="inline" method="post" action="/admin/sprints/cards/${card.id}/move"><input type="hidden" name="status" value="${to}"><button type="submit" class="link-btn" title="Mover pra ${CARD_STATUS_LABEL[to]}">${label}</button></form>`
      : "";
  return `
  <div class="card" draggable="true" data-id="${card.id}">
    <div class="card-top"><span class="type" style="background:${TYPE_COLOR[card.type] ?? "#888"}">${CARD_TYPE_LABEL[card.type] ?? escapeHtml(card.type)}</span><span class="num">#${card.id}</span></div>
    <div class="title">${escapeHtml(card.title)}</div>
    ${card.description ? `<div class="desc">${escapeHtml(card.description)}</div>` : ""}
    <div class="actions">
      ${moveBtn(prev, "◀")}${moveBtn(next, "▶")}
      <details><summary>editar</summary>
        <form method="post" action="/admin/sprints/cards/${card.id}/edit" class="edit-form">
          <input name="title" value="${escapeHtml(card.title)}" required>
          <textarea name="description" rows="2" placeholder="Descrição">${escapeHtml(card.description ?? "")}</textarea>
          <select name="type">${CARD_TYPES.map((t) => `<option value="${t}" ${t === card.type ? "selected" : ""}>${CARD_TYPE_LABEL[t]}</option>`).join("")}</select>
          <button type="submit" class="link-btn">Salvar</button>
        </form>
        <form method="post" action="/admin/sprints/cards/${card.id}/delete" onsubmit="return confirm('Apagar esse card?')"><button type="submit" class="link-btn danger">Apagar</button></form>
      </details>
    </div>
  </div>`;
}

export function renderSprintsPage(): string {
  const sprint = ensureActiveSprint();
  const cards = listCards(sprint.id);
  const left = daysLeft(sprint);
  const leftLabel = left > 0 ? `${left} dia(s) restante(s)` : left === 0 ? "termina hoje" : `${Math.abs(left)} dia(s) de atraso`;
  const doneCount = cards.filter((c) => c.status === "feito").length;

  const columns = CARD_STATUSES.map((status) => {
    const inColumn = cards.filter((c) => c.status === status);
    return `
    <div class="col" data-status="${status}">
      <h3>${CARD_STATUS_LABEL[status]} <span class="count">${inColumn.length}</span></h3>
      ${inColumn.map(renderCard).join("") || `<p class="empty">vazio</p>`}
    </div>`;
  }).join("");

  const closed = listSprints().filter((s) => s.id !== sprint.id);
  const closedHtml = closed.length
    ? closed
        .map((s) => {
          const sc = listCards(s.id);
          const done = sc.filter((c) => c.status === "feito").length;
          return `<details class="old"><summary>${escapeHtml(s.name)} — ${formatDateOnly(s.start_date)} a ${formatDateOnly(s.end_date)} (${done}/${sc.length} feitos)</summary>
            <ul>${sc.map((c) => `<li>[${CARD_STATUS_LABEL[c.status]}] ${CARD_TYPE_LABEL[c.type] ?? c.type}: ${escapeHtml(c.title)}</li>`).join("") || "<li>sem cards</li>"}</ul></details>`;
        })
        .join("")
    : `<p class="empty">Nenhum sprint encerrado ainda.</p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprints — Admin</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .sub { color: #666; margin: 0 0 16px; }
  .link-btn { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 0.8rem; }
  .link-btn.danger { border-color: #e08080; color: #c0392b; }
  .inline { display: inline; margin: 0; }
  .bar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .bar form { display: flex; gap: 6px; align-items: center; margin: 0; }
  input, select, textarea { padding: 5px 7px; border: 1px solid #ccc; border-radius: 6px; font: inherit; font-size: 0.85rem; }
  .add-form input[name=title] { min-width: 260px; }
  .board { display: grid; grid-template-columns: repeat(6, minmax(190px, 1fr)); gap: 10px; overflow-x: auto; align-items: start; }
  .col { background: #f4f5f7; border-radius: 8px; padding: 8px; min-height: 120px; }
  .col.over { outline: 2px dashed #2f6fee; }
  .col h3 { font-size: 0.85rem; margin: 2px 4px 8px; text-transform: uppercase; letter-spacing: .03em; color: #555; }
  .count { background: #dfe3ea; border-radius: 10px; padding: 0 7px; font-weight: 600; }
  .card { background: #fff; border-radius: 6px; padding: 8px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.12); cursor: grab; }
  .card-top { display: flex; justify-content: space-between; align-items: center; }
  .type { color: #fff; font-size: 0.68rem; border-radius: 4px; padding: 1px 6px; }
  .num { color: #999; font-size: 0.72rem; }
  .title { font-weight: 600; font-size: 0.88rem; margin: 5px 0 2px; word-break: break-word; }
  .desc { color: #555; font-size: 0.78rem; margin-bottom: 4px; word-break: break-word; }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; margin-top: 4px; }
  details summary { cursor: pointer; font-size: 0.78rem; color: #666; }
  .edit-form { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; }
  .empty { color: #999; font-size: 0.8rem; margin: 4px; }
  .old { margin: 6px 0; }
  a { color: #2f6fee; }
</style></head>
<body>
<p><a href="/admin">← Voltar ao painel</a></p>
<h1>${escapeHtml(sprint.name)} <small style="font-weight:400;color:#666">(ativo)</small></h1>
<p class="sub">${formatDateOnly(sprint.start_date)} a ${formatDateOnly(sprint.end_date)} · ${leftLabel} · ${doneCount}/${cards.length} feitos · hoje é ${formatDateOnly(spDateString())}</p>

<div class="bar">
  <form method="post" action="/admin/sprints/end-date">
    <label>Prazo (fim do sprint): <input type="date" name="end_date" value="${sprint.end_date}" required></label>
    <button type="submit" class="link-btn">Ajustar prazo</button>
  </form>
  <form method="post" action="/admin/sprints/close" onsubmit="return confirm('Encerrar esse sprint e abrir o próximo (10 dias)? O que não está em Feito passa pro novo sprint.')">
    <button type="submit" class="link-btn danger">Encerrar sprint e iniciar o próximo</button>
  </form>
</div>

<form class="bar add-form" method="post" action="/admin/sprints/cards">
  <input name="title" placeholder="Novo card (melhoria, evolução ou incidente)" required>
  <select name="type">${CARD_TYPES.map((t) => `<option value="${t}">${CARD_TYPE_LABEL[t]}</option>`).join("")}</select>
  <select name="status">${CARD_STATUSES.map((s) => `<option value="${s}">${CARD_STATUS_LABEL[s]}</option>`).join("")}</select>
  <input name="description" placeholder="Descrição (opcional)" style="min-width:220px">
  <button type="submit" class="link-btn">+ Adicionar</button>
</form>

<div class="board">${columns}</div>

<h2 style="font-size:1.05rem;margin-top:28px">Sprints anteriores</h2>
${closedHtml}

<script>
  let dragId = null;
  document.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('dragstart', () => { dragId = el.dataset.id; });
  });
  document.querySelectorAll('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      if (!dragId) return;
      await fetch('/admin/sprints/cards/' + dragId + '/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'status=' + encodeURIComponent(col.dataset.status),
      });
      location.reload();
    });
  });
</script>
</body></html>`;
}

// Monta as rotas de sprint no MESMO router do /admin, depois do middleware de
// sessao (ver admin.ts) -- por isso recebe o router em vez de criar um novo.
export function registerSprintRoutes(router: Router) {
  router.get("/admin/sprints", (_req, res) => {
    res.send(renderSprintsPage());
  });

  // usado pelo script scripts/sprint.ts (npm run sprint)
  router.get("/admin/sprints.json", (_req, res) => {
    const sprint = ensureActiveSprint();
    res.json({ sprint, cards: listCards(sprint.id) });
  });

  router.post("/admin/sprints/cards", (req, res) => {
    const type = isCardType(req.body.type) ? req.body.type : "melhoria";
    const status = isCardStatus(req.body.status) ? req.body.status : "backlog";
    const card = addCard({
      title: String(req.body.title ?? ""),
      description: req.body.description ? String(req.body.description) : undefined,
      type,
      status,
    });
    if (req.headers.accept?.includes("application/json")) {
      res.status(card ? 201 : 400).json({ card });
      return;
    }
    res.redirect("/admin/sprints");
  });

  router.post("/admin/sprints/cards/:id/move", (req, res) => {
    if (isCardStatus(req.body.status)) moveCard(Number(req.params.id), req.body.status);
    res.redirect("/admin/sprints");
  });

  router.post("/admin/sprints/cards/:id/edit", (req, res) => {
    updateCard(Number(req.params.id), {
      title: req.body.title !== undefined ? String(req.body.title) : undefined,
      description: req.body.description !== undefined ? String(req.body.description) : undefined,
      type: isCardType(req.body.type) ? req.body.type : undefined,
    });
    res.redirect("/admin/sprints");
  });

  router.post("/admin/sprints/cards/:id/delete", (req, res) => {
    deleteCard(Number(req.params.id));
    res.redirect("/admin/sprints");
  });

  router.post("/admin/sprints/end-date", (req, res) => {
    setSprintEndDate(ensureActiveSprint().id, String(req.body.end_date ?? ""));
    res.redirect("/admin/sprints");
  });

  router.post("/admin/sprints/close", (_req, res) => {
    closeActiveSprintAndStartNext();
    res.redirect("/admin/sprints");
  });
}
