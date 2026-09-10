import { Router } from "express";
import { listPaymentMethods, getOrCreatePaymentMethod, renamePaymentMethod, deletePaymentMethod, getDefaultPaymentMethod } from "../expenses/service";
import { renderPage } from "./layout";
import { normalizeBrazilPhone, escapeHtml, parsePagination, paginate, renderPagination } from "./utils";

export const paymentMethodsRouter = Router();

function getPhone(req: { query: Record<string, unknown> }): string {
  return typeof req.query.phone === "string" ? normalizeBrazilPhone(req.query.phone) : "";
}

paymentMethodsRouter.get("/dashboard/payment-methods", (req, res) => {
  const phone = getPhone(req);

  const methods = listPaymentMethods(phone);
  const defaultMethod = getDefaultPaymentMethod(phone);
  const qs = `phone=${encodeURIComponent(phone)}`;
  const { page, perPage } = parsePagination(req.query);
  const pageItems = paginate(methods, page, perPage);

  const rows = pageItems
    .map(
      (m) => `
      <tr>
        <td class="cell-form" data-label="Nome">
          <form class="inline" method="post" action="/dashboard/payment-methods/${m.id}?${qs}">
            <input type="text" name="name" value="${escapeHtml(m.name)}" style="width:220px">
            <button type="submit" class="btn secondary" style="padding:6px 10px">Salvar</button>
          </form>
        </td>
        <td data-label="Padrão">${defaultMethod?.id === m.id ? '<span class="tag">Padrão</span>' : "—"}</td>
        <td class="row-actions">
          <form class="inline" method="post" action="/dashboard/payment-methods/${m.id}/delete?${qs}" onsubmit="return confirm('Excluir \\'${escapeHtml(m.name)}\\'? Os gastos com ela ficam sem forma de pagamento.')">
            <button type="submit" class="link-action" style="background:none;border:none;cursor:pointer;padding:0;font:inherit">Excluir</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const body = `
  <header><h1>Formas de pagamento</h1></header>

  <div class="table-wrap"><table class="mobile-cards">
    <tr><th>Nome</th><th></th><th></th></tr>
    ${rows || `<tr><td colspan="3" class="empty">Nenhuma forma de pagamento ainda.</td></tr>`}
  </table></div>
  ${renderPagination({ basePath: "/dashboard/payment-methods", params: { phone }, page, perPage, total: methods.length })}
  <p style="color:var(--muted);font-size:0.82rem;margin-top:8px">A forma padrão é usada quando você não especifica no WhatsApp. Pra mudar, mande uma mensagem tipo "meu pagamento padrão é pix".</p>

  <h2 style="font-size:0.95rem;margin:28px 0 12px">Nova forma de pagamento</h2>
  <form class="card-form" method="post" action="/dashboard/payment-methods/new?${qs}">
    <label>Nome</label>
    <input type="text" name="name" required placeholder="Ex: Cartão Nubank">
    <div class="actions"><button type="submit" class="btn">Adicionar</button></div>
  </form>`;

  res.send(renderPage({ title: "Formas de pagamento", phone, active: "payments", body }));
});

paymentMethodsRouter.post("/dashboard/payment-methods/new", (req, res) => {
  const phone = getPhone(req);
  const name = String(req.body.name || "").trim();
  if (name) getOrCreatePaymentMethod(phone, name);
  res.redirect(`/dashboard/payment-methods?phone=${encodeURIComponent(phone)}`);
});

paymentMethodsRouter.post("/dashboard/payment-methods/:id", (req, res) => {
  const phone = getPhone(req);
  const name = String(req.body.name || "").trim();
  if (name) renamePaymentMethod(phone, Number(req.params.id), name);
  res.redirect(`/dashboard/payment-methods?phone=${encodeURIComponent(phone)}`);
});

paymentMethodsRouter.post("/dashboard/payment-methods/:id/delete", (req, res) => {
  const phone = getPhone(req);
  deletePaymentMethod(phone, Number(req.params.id));
  res.redirect(`/dashboard/payment-methods?phone=${encodeURIComponent(phone)}`);
});
