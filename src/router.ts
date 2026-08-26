import { sendText } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, extractCategoryFromAnswer, Interpretation } from "./ai/interpret";
import { createEvent, findUpcomingEvents, deleteEvent, listUpcomingEvents } from "./events/service";
import { createReminder, getRemindersWithinDays } from "./reminders/service";
import { currentWeekRange, currentMonthRange, lastNDaysRange, singleDayRange, buildExpenseReportText } from "./expenses/reportText";
import { setBudget, removeBudget, getBudget, listBudgets, checkBudgetAlert } from "./expenses/budgets";
import { setLastShownExpenses, getLastShownExpenses, clearLastShownExpenses } from "./expenses/listCache";
import { logActivity } from "./activity/service";
import { spDateString } from "./timeSP";
import {
  ensureUserSeeded,
  findCategoryByName,
  findCategoryByKeyword,
  findCategoryMentionedIn,
  getOrCreateCategory,
  learnKeyword,
  insertExpense,
  findRecentExpense,
  updateExpenseCategory,
  addPendingCategorization,
  getNextPendingCategorization,
  clearPendingCategorization,
  listCategories,
  getOrCreatePaymentMethod,
  getDefaultPaymentMethod,
  setDefaultPaymentMethod,
  setReportDayOfWeek,
  getExpenseSummaryBetween,
  getExpensesBetween,
  getExpenseById,
  updateExpense,
  ExpenseRecord,
  PendingCategorization,
} from "./expenses/service";
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// so string, sem Date: "2026-08-25" vira meia-noite UTC no construtor Date, que
// reprojetado pro fuso de Sao Paulo mostraria o dia anterior. expenses.date e
// sempre uma data-calendario pura, entao so reformatar o texto evita essa cilada.
function formatDateOnly(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// mensagem curta ("gasto", "criar evento"...) sinaliza a intencao mas falta
// informacao pra completar; pede o que falta em vez de um "nao entendi" generico
function unknownFollowUp(likelyIntent?: "expense" | "event" | "reminder"): string {
  switch (likelyIntent) {
    case "expense":
      return 'Beleza, um gasto! Me diga o valor e do que foi, tudo numa mensagem só — ex: "50 no mercado" ou "35,90 na farmácia no pix".';
    case "event":
      return 'Beleza, um evento! Me diga o quê, quando e que horas — ex: "dentista amanhã 15h".';
    case "reminder":
      return 'Beleza, um lembrete! Me diga o quê e quando te avisar — ex: "me lembra de pagar a internet sexta 9h".';
    default:
      return "Não entendi se isso é um gasto, um evento (criar ou cancelar) ou um lembrete. Pode reformular?";
  }
}

// Formato do evento "messages.upsert" da Evolution API. O campo com o audio/imagem
// em base64 pode vir em lugares diferentes dependendo da versao/config da API.
interface EvolutionMessage {
  key: { remoteJid: string; fromMe: boolean };
  messageType: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    base64?: string;
    audioMessage?: { mimetype?: string };
    imageMessage?: { mimetype?: string };
  };
  base64?: string;
}

export async function handleIncomingMessage(data: EvolutionMessage) {
  const from = data.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");
  const base64Media = data.message?.base64 ?? data.base64;

  // Cada numero tem categorias/formas de pagamento proprias, isoladas dos demais;
  // na primeira mensagem desse numero, cria as categorias/formas padrao pra ele.
  ensureUserSeeded(from);

  let text: string | undefined;
  if (data.messageType === "conversation" || data.messageType === "extendedTextMessage") {
    text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
  } else if (data.messageType === "audioMessage" && base64Media) {
    text = await transcribeAudio(Buffer.from(base64Media, "base64"));
  }

  // Enquanto tiver categorizacao pendente pra esse numero, a proxima mensagem
  // de texto/audio e tratada como resposta a "qual categoria e isso?", nao como pedido novo.
  if (text !== undefined) {
    const pending = getNextPendingCategorization(from);
    if (pending) {
      await resolvePendingCategorization(from, pending, text);
      return;
    }
  }

  let interpretations: Interpretation[];
  if (text !== undefined) {
    interpretations = await interpretText(from, text);
  } else if (data.messageType === "imageMessage" && base64Media) {
    const mimeType = data.message?.imageMessage?.mimetype ?? "image/jpeg";
    interpretations = await interpretReceiptImage(from, base64Media, mimeType);
  } else {
    await sendText(from, "Por enquanto so entendo texto, audio e imagem de comprovante. 🙂");
    return;
  }

  // Uma mensagem pode conter varios pedidos (ex: "marca dentista amanha e reuniao sexta");
  // processa cada acao separadamente, uma falha nao impede as outras.
  for (const interpretation of interpretations) {
    try {
      await handleInterpretation(from, interpretation);
    } catch (err) {
      console.error("Erro ao processar interpretacao:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, "Deu erro aqui do meu lado tentando processar isso. Tenta de novo em instantes.");
    }
  }
}

// Se a mensagem mencionou a forma de pagamento, usa ela; senao cai pro padrao do
// usuario (se tiver configurado); senao fica sem forma de pagamento definida.
function resolvePaymentMethod(from: string, mentioned?: string | null) {
  if (mentioned) return getOrCreatePaymentMethod(from, mentioned);
  return getDefaultPaymentMethod(from);
}

function askForCategory(from: string, amount: number, description: string) {
  const categoryNames = listCategories(from)
    .map((c) => c.name)
    .join(", ");
  return sendText(
    from,
    `Qual categoria é esse gasto de R$${amount.toFixed(2)} (${description})?\n\nCategorias: ${categoryNames}\n\nPode responder com uma dessas ou dizer uma categoria nova.`
  );
}

async function resolvePendingCategorization(from: string, pending: PendingCategorization, answerText: string) {
  try {
    // resposta curta (ate 3 palavras) e tratada como o nome da categoria direto;
    // frases mais longas passam pela IA pra extrair so o nome pretendido.
    const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
    const categoryName =
      findCategoryMentionedIn(from, answerText)?.name ??
      (wordCount <= 3 ? answerText.trim() : await extractCategoryFromAnswer(answerText));
    const category = getOrCreateCategory(from, categoryName);
    const paymentMethod = resolvePaymentMethod(from, pending.suggested_payment_method);

    insertExpense({
      fromNumber: from,
      amount: pending.amount,
      description: pending.description,
      categoryId: category.id,
      paymentMethodId: paymentMethod?.id ?? null,
      date: pending.date,
    });
    if (pending.suggested_category) learnKeyword(from, pending.suggested_category, category.id);
    learnKeyword(from, pending.description, category.id);

    clearPendingCategorization(pending.id);

    const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
    logActivity(
      from,
      "expense",
      `R$${pending.amount.toFixed(2)} em ${category.name}${paymentSuffix} — ${pending.description} (categorizado manualmente)`
    );
    const budgetAlert = checkBudgetAlert(from, category.id, category.name) ?? "";
    await sendText(from, `✅ Categorizado como "${category.name}". Gasto de R$${pending.amount.toFixed(2)}${paymentSuffix} registrado.${budgetAlert}`);

    // se tinha mais gastos esperando categoria, pergunta o proximo da fila
    const next = getNextPendingCategorization(from);
    if (next) await askForCategory(from, next.amount, next.description);
  } catch (err) {
    console.error("Erro ao resolver categorizacao pendente:", err);
    logActivity(from, "error", err instanceof Error ? err.message : String(err));
    await sendText(from, "Deu erro tentando salvar a categoria. Tenta me responder de novo.");
  }
}

async function handleInterpretation(from: string, interpretation: Interpretation) {
  // "editar o 2" so faz sentido logo depois de uma lista mostrada; qualquer outro
  // pedido no meio invalida essa referencia por numero
  if (interpretation.type !== "list_expenses" && interpretation.type !== "edit_expense") {
    clearLastShownExpenses(from);
  }

  switch (interpretation.type) {
    case "expense": {
      // a IA nem sempre preenche descricao/data em mensagens bem curtas ("gastei 60 no mercado")
      const description = interpretation.description?.trim() || interpretation.category;
      const date = interpretation.date || spDateString();
      const category =
        findCategoryByName(from, interpretation.category) ?? findCategoryByKeyword(from, interpretation.category, description);

      if (category) {
        const paymentMethod = resolvePaymentMethod(from, interpretation.payment_method);
        insertExpense({
          fromNumber: from,
          amount: interpretation.amount,
          description,
          categoryId: category.id,
          paymentMethodId: paymentMethod?.id ?? null,
          date,
        });
        const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
        logActivity(from, "expense", `R$${interpretation.amount.toFixed(2)} em ${category.name}${paymentSuffix} — ${description}`);
        const budgetAlert = checkBudgetAlert(from, category.id, category.name) ?? "";
        await sendText(from, `✅ Gasto registrado: R$${interpretation.amount.toFixed(2)} em ${category.name}${paymentSuffix}${budgetAlert}`);
      } else {
        // se ja tem pendencia(s) na fila, so entra na fila; a pergunta em si so
        // sai quando chega a vez dele (ver resolvePendingCategorization)
        const alreadyWaiting = getNextPendingCategorization(from) !== null;
        addPendingCategorization({
          from_number: from,
          amount: interpretation.amount,
          description,
          date,
          suggested_category: interpretation.category ?? null,
          suggested_payment_method: interpretation.payment_method ?? null,
        });
        logActivity(from, "expense", `pendente de categoria: R$${interpretation.amount.toFixed(2)} — ${description}`);
        if (!alreadyWaiting) await askForCategory(from, interpretation.amount, description);
      }
      break;
    }
    case "correct_category": {
      const expense = findRecentExpense(from, interpretation.query);
      if (!expense) {
        logActivity(from, "correct_category", `nenhum gasto encontrado para "${interpretation.query ?? "mais recente"}"`);
        await sendText(from, `Não achei nenhum gasto recente${interpretation.query ? ` parecido com "${interpretation.query}"` : ""} pra corrigir.`);
        break;
      }
      const category = getOrCreateCategory(from, interpretation.category);
      updateExpenseCategory(expense.id, category.id);
      learnKeyword(from, expense.description, category.id);
      logActivity(from, "correct_category", `${expense.description} — R$${expense.amount.toFixed(2)} agora e "${category.name}"`);
      await sendText(from, `✏️ Categoria de "${expense.description}" (R$${expense.amount.toFixed(2)}) corrigida para "${category.name}"`);
      break;
    }
    case "set_default_payment": {
      const paymentMethod = getOrCreatePaymentMethod(from, interpretation.payment_method);
      setDefaultPaymentMethod(from, paymentMethod.id);
      logActivity(from, "set_default_payment", `forma de pagamento padrao agora e "${paymentMethod.name}"`);
      await sendText(from, `✅ Forma de pagamento padrão definida como "${paymentMethod.name}". Vou usar essa quando você não especificar outra.`);
      break;
    }
    case "event": {
      const created = createEvent({
        fromNumber: from,
        title: interpretation.title,
        start: interpretation.start,
        end: interpretation.end,
        location: interpretation.location,
      });
      logActivity(from, "event", `${interpretation.title} — ${interpretation.start}`);
      await sendText(from, `📅 Evento "${interpretation.title}" criado na agenda (aviso ${created.reminder_minutes} min antes)`);
      break;
    }
    case "delete_event": {
      const matches = findUpcomingEvents(from, interpretation.query);
      if (matches.length === 0) {
        logActivity(from, "delete_event", `nenhum evento encontrado para "${interpretation.query}"`);
        await sendText(from, `Não encontrei nenhum evento parecido com "${interpretation.query}" nos próximos 60 dias.`);
      } else if (matches.length === 1) {
        const event = matches[0];
        deleteEvent(from, event.id);
        logActivity(from, "delete_event", `removido: ${event.title}`);
        await sendText(from, `🗑️ Evento "${event.title}" removido da agenda`);
      } else {
        const list = matches.map((e) => `• ${e.title} — ${formatDateTime(e.start)}`).join("\n");
        logActivity(from, "delete_event", `${matches.length} eventos parecidos com "${interpretation.query}", pedi pra especificar`);
        await sendText(from, `Achei mais de um evento parecido com "${interpretation.query}":\n${list}\n\nMe diga o nome mais específico de qual quer cancelar.`);
      }
      break;
    }
    case "reminder": {
      createReminder(from, interpretation.message, interpretation.due_at);
      logActivity(from, "reminder", `${interpretation.message} — ${interpretation.due_at}`);
      await sendText(from, `⏰ Lembrete criado: "${interpretation.message}"`);
      break;
    }
    case "report": {
      const days = interpretation.days ?? 7;
      const events = listUpcomingEvents(from, days);
      const reminders = getRemindersWithinDays(days);

      const eventsText = events.length
        ? events.map((e) => `• ${e.title} — ${formatDateTime(e.start)}`).join("\n")
        : "Nenhum evento agendado.";
      const remindersText = reminders.length
        ? reminders.map((r) => `• ${r.message} — ${formatDateTime(r.due_at)}`).join("\n")
        : "Nenhum lembrete agendado.";

      logActivity(from, "report", `proximos ${days} dias: ${events.length} eventos, ${reminders.length} lembretes`);
      await sendText(from, `📊 Próximos ${days} dias\n\n📅 Agenda:\n${eventsText}\n\n⏰ Lembretes:\n${remindersText}`);
      break;
    }
    case "expense_report": {
      const range = interpretation.days
        ? lastNDaysRange(interpretation.days)
        : interpretation.period === "week"
          ? currentWeekRange()
          : currentMonthRange();

      const category = interpretation.category
        ? findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category)
        : null;

      const text = buildExpenseReportText(range, {
        compare: true,
        fromNumber: from,
        categoryId: category?.id,
        categoryName: category?.name,
      });
      logActivity(from, "expense_report", `${range.label}${category ? ` (${category.name})` : ""}`);
      await sendText(from, text);
      break;
    }
    case "set_report_day": {
      const dayMap: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
      const dayNumber = dayMap[interpretation.day_of_week];
      if (dayNumber === undefined) {
        await sendText(from, "Não entendi o dia. Pode ser: domingo, segunda, terça, quarta, quinta, sexta ou sábado.");
        break;
      }
      setReportDayOfWeek(from, dayNumber);
      logActivity(from, "set_report_day", `relatorio semanal agora chega toda(o) ${interpretation.day_of_week}`);
      await sendText(
        from,
        `✅ Combinado! Vou te mandar o relatório de gastos da semana toda ${interpretation.day_of_week} de manhã, e o relatório do mês no último dia de cada mês às 18h.`
      );
      break;
    }
    case "set_budget": {
      const category = getOrCreateCategory(from, interpretation.category);
      setBudget(from, category.id, interpretation.amount);
      logActivity(from, "set_budget", `orcamento de ${category.name} definido em R$${interpretation.amount.toFixed(2)}/mes`);
      await sendText(
        from,
        `✅ Orçamento de "${category.name}" definido em R$${interpretation.amount.toFixed(2)} por mês. Te aviso quando chegar perto ou passar disso.`
      );
      break;
    }
    case "remove_budget": {
      const category = findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category);
      const removed = category ? removeBudget(from, category.id) : false;
      logActivity(from, "remove_budget", removed ? `orcamento de ${category!.name} removido` : `nenhum orcamento encontrado para "${interpretation.category}"`);
      await sendText(
        from,
        removed
          ? `✅ Orçamento de "${category!.name}" removido.`
          : `Não achei orçamento definido pra "${interpretation.category}".`
      );
      break;
    }
    case "list_budgets": {
      const range = currentMonthRange();

      if (interpretation.category) {
        const category = findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category);
        if (!category) {
          logActivity(from, "list_budgets", `categoria "${interpretation.category}" nao encontrada`);
          await sendText(from, `Não achei uma categoria parecida com "${interpretation.category}".`);
          break;
        }
        const limit = getBudget(from, category.id);
        if (limit == null) {
          logActivity(from, "list_budgets", `sem orcamento definido pra ${category.name}`);
          await sendText(
            from,
            `Você não tem orçamento definido pra "${category.name}". Pode dizer algo como "me avisa se eu passar de R$300 em ${category.name}".`
          );
          break;
        }
        const spent = getExpenseSummaryBetween(range.start, range.end, from, category.id).total;
        logActivity(from, "list_budgets", `${category.name}: R$${spent.toFixed(2)} de R$${limit.toFixed(2)}`);
        await sendText(from, `📋 Orçamento de "${category.name}" (mês atual): R$${spent.toFixed(2)} de R$${limit.toFixed(2)}`);
        break;
      }

      const budgets = listBudgets(from);
      if (!budgets.length) {
        await sendText(from, "Você ainda não tem nenhum orçamento definido. Pode dizer algo como \"me avisa se eu passar de R$500 em Lazer\".");
        break;
      }
      const lines = budgets.map((b) => {
        const spent = getExpenseSummaryBetween(range.start, range.end, from, b.category_id).total;
        return `• ${b.category_name}: R$${spent.toFixed(2)} de R$${b.monthly_limit.toFixed(2)}`;
      });
      logActivity(from, "list_budgets", `${budgets.length} orcamento(s)`);
      await sendText(from, `📋 Seus orçamentos (mês atual):\n\n${lines.join("\n")}`);
      break;
    }
    case "list_categories": {
      const categories = listCategories(from);
      logActivity(from, "list_categories", `${categories.length} categoria(s)`);
      if (!categories.length) {
        await sendText(from, "Você ainda não tem nenhuma categoria. Elas vão sendo criadas conforme você registra gastos.");
        break;
      }
      const lines = categories.map((c) => `• ${c.name}`).join("\n");
      await sendText(from, `🏷️ Suas categorias:\n\n${lines}`);
      break;
    }
    case "list_expenses": {
      // pedido vago tipo "editar compras", sem dia nenhum mencionado: antes de
      // mostrar a lista, avisa qual dia foi assumido, pra nao confundir quem
      // queria outro dia
      const noDaySpecified = !interpretation.date && !interpretation.days;
      if (noDaySpecified) {
        await sendText(
          from,
          `Você não disse o dia, então vou te mostrar as compras de hoje. Se quiser outro dia, é só especificar, ex: "editar compras de ontem" ou "gastos do dia 20".`
        );
      }

      const range = interpretation.date
        ? singleDayRange(interpretation.date.slice(0, 10), formatDateOnly(interpretation.date))
        : interpretation.days
          ? lastNDaysRange(interpretation.days)
          : singleDayRange(spDateString(), "hoje");

      const items = getExpensesBetween(from, range.start, range.end);
      if (!items.length) {
        logActivity(from, "list_expenses", `nenhum gasto em ${range.label}`);
        await sendText(from, `Nenhum gasto registrado em ${range.label}.`);
        break;
      }

      setLastShownExpenses(from, items.map((item) => item.id));
      const lines = items.map((item, idx) => {
        const details = [item.category ?? "sem categoria", item.payment_method].filter(Boolean).join(", ");
        return `${idx + 1}. R$${item.amount.toFixed(2)} — ${item.description} (${details}) — ${formatDateOnly(item.date)}`;
      });
      logActivity(from, "list_expenses", `${items.length} gasto(s) em ${range.label}`);
      await sendText(
        from,
        `🧾 Gastos — ${range.label}\n\n${lines.join("\n")}\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45" ou "o 2 foi no pix".`
      );
      break;
    }
    case "edit_expense": {
      let expense: ExpenseRecord | null;
      if (interpretation.list_ref) {
        const ids = getLastShownExpenses(from);
        const id = ids?.[interpretation.list_ref - 1];
        expense = id ? getExpenseById(from, id) : null;
        if (!expense) {
          logActivity(from, "edit_expense", `referencia "${interpretation.list_ref}" sem lista valida`);
          await sendText(
            from,
            `Não sei a que gasto o número "${interpretation.list_ref}" se refere. De qual dia são as compras que você quer editar?`
          );
          break;
        }
      } else {
        expense = findRecentExpense(from, interpretation.query);
        if (!expense) {
          logActivity(from, "edit_expense", `nenhum gasto encontrado para "${interpretation.query ?? "mais recente"}"`);
          await sendText(from, `Não achei nenhum gasto recente${interpretation.query ? ` parecido com "${interpretation.query}"` : ""} pra editar.`);
          break;
        }
      }

      const params = {
        amount: expense.amount,
        description: expense.description,
        date: expense.date,
        categoryId: expense.category_id,
        paymentMethodId: expense.payment_method_id,
      };
      let changeText = "";
      let errorText = "";

      if (interpretation.field === "amount") {
        const amount = Number(interpretation.value.replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0) errorText = `Não entendi o valor "${interpretation.value}".`;
        else {
          params.amount = amount;
          changeText = `valor agora é R$${amount.toFixed(2)}`;
        }
      } else if (interpretation.field === "date") {
        params.date = interpretation.value;
        changeText = `data agora é ${formatDateOnly(interpretation.value)}`;
      } else if (interpretation.field === "description") {
        params.description = interpretation.value;
        changeText = `descrição agora é "${interpretation.value}"`;
      } else if (interpretation.field === "payment_method") {
        const paymentMethod = getOrCreatePaymentMethod(from, interpretation.value);
        params.paymentMethodId = paymentMethod.id;
        changeText = `forma de pagamento agora é "${paymentMethod.name}"`;
      }

      if (errorText) {
        logActivity(from, "edit_expense", errorText);
        await sendText(from, errorText);
        break;
      }

      updateExpense(from, expense.id, params);
      logActivity(from, "edit_expense", `#${expense.id} ${expense.description}: ${changeText}`);
      await sendText(from, `✏️ Gasto "${expense.description}" atualizado: ${changeText}`);
      break;
    }
    default: {
      logActivity(from, "unknown", interpretation.description ?? "nao classificado");
      await sendText(from, unknownFollowUp(interpretation.likely_intent));
    }
  }
}
