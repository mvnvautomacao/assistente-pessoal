// O WhatsApp guarda numeros brasileiros sem o "9" extra depois do DDD
// (55 + DDD + 9 + numero = 13 digitos vira 12). Quem digita o proprio numero no
// formato normal (com o 9) precisa continuar achando os dados dele mesmo assim.
export function normalizeBrazilPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(digits)) {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "1234.5" -> "1.234,50" — pro valor inicial do campo mascarado (sem o "R$")
export function formatAmountInput(amount: number): string {
  const cents = Math.round(amount * 100);
  const intPart = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centsPart = String(cents % 100).padStart(2, "0");
  return `${intPart},${centsPart}`;
}

// So string, sem passar por Date: "2026-08-25" (date-only) e interpretado pelo
// construtor Date como meia-noite UTC, que reprojetado pro fuso de Sao Paulo
// (UTC-3) vira o dia anterior. expenses.date e sempre uma data-calendario "pura"
// (nunca mostramos hora pra gasto), entao so reformatar o texto evita essa cilada.
export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// "YYYY-MM-DD" no fuso de Sao Paulo, pro valor padrao de inputs type=date
export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// celulas do grid do calendario do mes: um array (multiplo de 7) de "YYYY-MM-DD"
// ou null (dias vazios antes do dia 1 ou depois do ultimo dia, pra fechar a semana)
export function calendarCells(yearMonth: string): (string | null)[] {
  const [year, month] = yearMonth.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=domingo
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${yearMonth}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const spDateTimeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ISO (qualquer fuso) -> "YYYY-MM-DDTHH:mm" no horario de Sao Paulo,
// pro valor de um input type="datetime-local"
export function toSPDateTimeLocal(iso: string): string {
  const parts = Object.fromEntries(spDateTimeParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// "YYYY-MM-DDTHH:mm" (digitado como horario de Sao Paulo) -> ISO com offset -03:00.
// Brasil nao tem mais horario de verao desde 2019, entao -03:00 vale o ano todo.
export function fromSPDateTimeLocal(value: string): string {
  return `${value}:00-03:00`;
}

// Monta um CSV pro Excel em portugues do Brasil: ";" como separador de campo
// (a virgula ali e o separador decimal no Excel PT-BR, entao usar virgula como
// separador de campo quebraria a leitura), e um BOM UTF-8 no inicio, senao o
// Excel abre acento (á, ã, ç...) corrompido.
function csvField(value: string): string {
  return /[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const BOM = "﻿";
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(";"));
  return BOM + lines.join("\r\n");
}

// "1234.5" -> "1234,50", pra celula de valor no CSV (decimal com virgula, sem
// separador de milhar, pra nao confundir com o separador de campo)
export function formatAmountCsv(amount: number): string {
  return amount.toFixed(2).replace(".", ",");
}

export const PAGE_SIZES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function parsePagination(query: Record<string, unknown>): { page: number; perPage: number } {
  const rawPerPage = Number(query.per_page);
  const perPage = PAGE_SIZES.includes(rawPerPage) ? rawPerPage : 10;
  const rawPage = Number(query.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { page, perPage };
}

export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

// Controles de paginacao (tamanho de pagina + anterior/proximo), reutilizavel em
// qualquer lista do dashboard -- so aparece se tiver mais de 10 itens (senao nao
// ha o que paginar). "params" carrega os outros filtros da URL atual (phone,
// month, q, days...) pra nao se perderem ao trocar de pagina/tamanho.
export function renderPagination(opts: {
  basePath: string;
  params: Record<string, string>;
  page: number;
  perPage: number;
  total: number;
}): string {
  if (opts.total <= 10) return "";

  const totalPages = Math.max(1, Math.ceil(opts.total / opts.perPage));
  const page = Math.min(Math.max(1, opts.page), totalPages);

  const linkFor = (p: number) => `${opts.basePath}?${new URLSearchParams({ ...opts.params, page: String(p), per_page: String(opts.perPage) })}`;

  const hiddenInputs = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  const sizeOptions = PAGE_SIZES.map((n) => `<option value="${n}" ${n === opts.perPage ? "selected" : ""}>${n}</option>`).join("");

  return `
  <div class="pagination">
    <form method="get" action="${opts.basePath}" class="pagination-size">
      ${hiddenInputs}
      <input type="hidden" name="page" value="1">
      <label for="per_page">Mostrar</label>
      <select name="per_page" id="per_page" onchange="this.form.submit()">${sizeOptions}</select>
      <span>por página</span>
    </form>
    <div class="pagination-nav">
      ${page <= 1 ? `<span class="arrow disabled">‹</span>` : `<a class="arrow" href="${linkFor(page - 1)}">‹</a>`}
      <span>Página ${page} de ${totalPages} · ${opts.total} resultado(s)</span>
      ${page >= totalPages ? `<span class="arrow disabled">›</span>` : `<a class="arrow" href="${linkFor(page + 1)}">›</a>`}
    </div>
  </div>`;
}

// Mascara de moeda BR (milhar com ponto, 2 casas decimais com virgula), reutilizavel
// em qualquer pagina: cada <input class="money-mask"> precisa de um
// <input type="hidden"> logo em seguida no HTML, que recebe o valor decimal puro
// (ponto) pra ser o que de fato e enviado no form.
export const MONEY_MASK_SCRIPT = `
  <script>
    (function () {
      function formatMoneyMask(raw) {
        var digits = raw.replace(/\\D/g, "");
        if (!digits) return "";
        var n = parseInt(digits, 10);
        var cents = String(n % 100).padStart(2, "0");
        var intPart = Math.floor(n / 100).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
        return intPart + "," + cents;
      }
      document.querySelectorAll(".money-mask").forEach(function (input) {
        var hidden = input.nextElementSibling;
        input.addEventListener("input", function () {
          input.value = formatMoneyMask(input.value);
          if (hidden) hidden.value = input.value ? input.value.replace(/\\./g, "").replace(",", ".") : "";
        });
      });
    })();
  </script>`;
