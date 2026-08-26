import { sendText } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, extractCategoryFromAnswer, Interpretation } from "./ai/interpret";
import { createEvent, findUpcomingEvents, deleteEvent, listUpcomingEvents } from "./events/service";
import { createReminder, getRemindersWithinDays } from "./reminders/service";
import { currentWeekRange, currentMonthRange, lastNDaysRange, buildExpenseReportText } from "./expenses/reportText";
import { setBudget, removeBudget, listBudgets, checkBudgetAlert } from "./expenses/budgets";
import { logActivity } from "./activity/service";
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
  PendingCategorization,
} from "./expenses/service";
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
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
  switch (interpretation.type) {
    case "expense": {
      // a IA nem sempre preenche descricao/data em mensagens bem curtas ("gastei 60 no mercado")
      const description = interpretation.description?.trim() || interpretation.category;
      const date = interpretation.date || new Date().toISOString();
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
      const budgets = listBudgets(from);
      if (!budgets.length) {
        await sendText(from, "Você ainda não tem nenhum orçamento definido. Pode dizer algo como \"me avisa se eu passar de R$500 em Lazer\".");
        break;
      }
      const range = currentMonthRange();
      const lines = budgets.map((b) => {
        const spent = getExpenseSummaryBetween(range.start, range.end, from, b.category_id).total;
        return `• ${b.category_name}: R$${spent.toFixed(2)} de R$${b.monthly_limit.toFixed(2)}`;
      });
      logActivity(from, "list_budgets", `${budgets.length} orcamento(s)`);
      await sendText(from, `📋 Seus orçamentos (mês atual):\n\n${lines.join("\n")}`);
      break;
    }
    default: {
      logActivity(from, "unknown", interpretation.description ?? "nao classificado");
      await sendText(from, "Nao entendi se isso e um gasto, um evento (criar ou cancelar) ou um lembrete. Pode reformular?");
    }
  }
}
