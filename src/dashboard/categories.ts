import { Router } from "express";
import { listCategories, getOrCreateCategory, renameCategory, deleteCategory } from "../expenses/service";
import { renderPage, renderPhoneGate } from "./layout";
import { normalizeBrazilPhone, escapeHtml } from "./utils";

export const categoriesRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

categoriesRouter.get("/dashboard/categories", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());

  const categories = listCategories(phone);
  const qs = `phone=${encodeURIComponent(phone)}`;

  const rows = categories
    .map(
      (c) => `
      <tr>
        <td>
          <form class="inline" method="post" action="/dashboard/categories/${c.id}?${qs}">
            <input type="text" name="name" value="${escapeHtml(c.name)}" style="width:220px">
            <button type="submit" class="btn secondary" style="padding:6px 10px">Salvar</button>
          </form>
        </td>
        <td class="row-actions">
          <form class="inline" method="post" action="/dashboard/categories/${c.id}/delete?${qs}" onsubmit="return confirm('Excluir a categoria \\'${escapeHtml(c.name)}\\'? Os gastos dela ficam sem categoria.')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const body = `
  <header><h1>Categorias</h1></header>

  <table>
    <tr><th>Nome</th><th></th></tr>
    ${rows || `<tr><td colspan="2" class="empty">Nenhuma categoria ainda.</td></tr>`}
  </table>

  <h2 style="font-size:0.95rem;margin:28px 0 12px">Nova categoria</h2>
  <form class="card-form" method="post" action="/dashboard/categories/new?${qs}">
    <label>Nome</label>
    <input type="text" name="name" required>
    <div class="actions"><button type="submit" class="btn">Adicionar</button></div>
  </form>`;

  res.send(renderPage({ title: "Categorias", phone, active: "categories", body }));
});

categoriesRouter.post("/dashboard/categories/new", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const name = String(req.body.name || "").trim();
  if (name) getOrCreateCategory(phone, name);
  res.redirect(`/dashboard/categories?phone=${encodeURIComponent(phone)}`);
});

categoriesRouter.post("/dashboard/categories/:id", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  const name = String(req.body.name || "").trim();
  if (name) renameCategory(phone, Number(req.params.id), name);
  res.redirect(`/dashboard/categories?phone=${encodeURIComponent(phone)}`);
});

categoriesRouter.post("/dashboard/categories/:id/delete", (req, res) => {
  const phone = getPhone(req);
  if (!phone) return res.send(renderPhoneGate());
  deleteCategory(phone, Number(req.params.id));
  res.redirect(`/dashboard/categories?phone=${encodeURIComponent(phone)}`);
});
