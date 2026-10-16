// Filtros das consultas de gastos (Card 14, RN04): categoria e forma de pagamento citadas pelo usuario viram ids,
// sem diferenciar acento nem maiuscula. Nao achou: mensagem com o nome pedido e como ver as opcoes.
import { findCategoryByName, findCategoryMentionedIn, listPaymentMethods } from "./service";
import { matchesQuery, normalizeSearch } from "../text/search";

export interface ExpenseFilters {
  categoryId?: number;
  categoryName?: string;
  paymentMethodId?: number;
  paymentMethodName?: string;
  // so gastos com marca de conta fixa, de qualquer origem (Card 15)
  fixedOnly?: boolean;
}

export type FilterResult = { ok: true; filters: ExpenseFilters } | { ok: false; message: string };

export function categoryNotFoundText(name: string): string {
  return `Não achei a categoria "${name}". Pra ver as suas, diga "minhas categorias".`;
}

export function paymentMethodNotFoundText(name: string, available: string[]): string {
  const options = available.length ? ` As suas são: ${available.join(", ")}.` : "";
  return `Não achei a forma de pagamento "${name}".${options}`;
}

export function resolveExpenseFilters(fromNumber: string, request: { category?: string; payment_method?: string; fixed_only?: boolean }): FilterResult {
  const filters: ExpenseFilters = {};
  if (request.fixed_only === true) filters.fixedOnly = true;

  const categoryName = request.category?.trim();
  if (categoryName) {
    // igual ao relatorio: nome exato (sem acento) ou uma categoria citada na frase ("supermercados" -> Mercado)
    const category = findCategoryByName(fromNumber, categoryName) ?? findCategoryMentionedIn(fromNumber, categoryName);
    if (!category) return { ok: false, message: categoryNotFoundText(categoryName) };
    filters.categoryId = category.id;
    filters.categoryName = category.name;
  }

  const paymentName = request.payment_method?.trim();
  if (paymentName) {
    const methods = listPaymentMethods(fromNumber);
    const wanted = normalizeSearch(paymentName);
    const method = methods.find((m) => normalizeSearch(m.name) === wanted) ?? methods.find((m) => matchesQuery(m.name, paymentName));
    if (!method) return { ok: false, message: paymentMethodNotFoundText(paymentName, methods.map((m) => m.name)) };
    filters.paymentMethodId = method.id;
    filters.paymentMethodName = method.name;
  }

  return { ok: true, filters };
}

export function hasAnyFilter(filters: ExpenseFilters): boolean {
  return filters.categoryId !== undefined || filters.paymentMethodId !== undefined || filters.fixedOnly === true;
}

// "Mercado · Pix" (titulo das ultimas N)
export function filterLabel(filters: ExpenseFilters): string {
  return [filters.fixedOnly ? "Contas fixas" : null, filters.categoryName, filters.paymentMethodName].filter(Boolean).join(" · ");
}

// "de Mercado no Pix" (frase dentro de "Nenhum gasto ... em setembro/2026" e do titulo de periodo)
export function filterPhrase(filters: ExpenseFilters): string {
  const parts: string[] = [];
  if (filters.categoryName) parts.push(`de ${filters.categoryName}`);
  if (filters.paymentMethodName) parts.push(`no ${filters.paymentMethodName}`);
  return parts.join(" ");
}
