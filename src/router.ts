import { sendText, getBase64FromMediaMessage } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import { interpretText, interpretReceiptImage, extractCategoryFromAnswer, Interpretation } from "./ai/interpret";
import { createEvent, findUpcomingEvents, deleteEvent, listUpcomingEvents, getEventById } from "./events/service";
import { createReminder, getRemindersWithinDays, deleteReminder } from "./reminders/service";
import { currentWeekRange, currentMonthRange, lastNDaysRange, singleDayRange, buildExpenseReportText } from "./expenses/reportText";
import { setBudget, removeBudget, getBudget, listBudgets, checkBudgetAlert } from "./expenses/budgets";
import { setLastShownExpenses, getLastShownExpenses, clearLastShownExpenses } from "./expenses/listCache";
import { setPendingListChoice, getPendingListChoice, clearPendingListChoice } from "./expenses/pendingListChoice";
import { setPendingEventDeletion, getPendingEventDeletion, clearPendingEventDeletion } from "./events/pendingDeletion";
import { setPendingUndo, getPendingUndo, clearPendingUndo } from "./undo/pendingUndo";
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
  deleteExpense,
  ExpenseRecord,
  ExpenseListItem,
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

// resposta pra uma duvida especifica ("como adiciono um gasto?"), com explicacao
// clara e um exemplo pronto pra copiar — pensado pra quem tem menos familiaridade
// com tecnologia, entao frases curtas e nada de termos tecnicos
function helpTopicMessage(
  topic?: "expense" | "event" | "reminder" | "budget" | "expense_report" | "edit_expense" | "category" | "payment_method" | "welcome"
): string | null {
  switch (topic) {
    case "welcome":
      return WELCOME_MESSAGE;
    case "expense":
      return `💰 Como registrar um gasto:

É bem simples — só mandar uma mensagem contando o que você comprou e quanto pagou.

Exemplo: escreva ou fale "gastei 50 reais no mercado"

Você também pode:
• Mandar um áudio falando a mesma coisa
• Mandar uma foto do comprovante ou nota fiscal

Eu registro sozinho e já escolho a categoria (tipo "Mercado", "Saúde"...). Se eu não souber qual categoria usar, eu pergunto pra você.`;
    case "event":
      return `📅 Como marcar um compromisso na agenda:

Diga o que é, o dia e a hora, tudo numa mensagem só.

Exemplo: "marca consulta no médico dia 15 às 14h"

Eu aviso você um tempo antes do horário chegar, pra não esquecer. Pra cancelar, é só dizer, tipo "cancela a consulta do dia 15".`;
    case "reminder":
      return `⏰ Como criar um lembrete:

Diga o que você quer lembrar e quando.

Exemplo: "me lembra de tomar remédio às 20h"

Na hora certa eu mando uma mensagem avisando.`;
    case "budget":
      return `🎯 Como definir um limite de gastos (orçamento):

Diga o valor e a categoria que você quer controlar.

Exemplo: "me avisa se eu passar de 300 reais em mercado"

Quando você chegar perto ou passar desse valor no mês, eu aviso automaticamente.`;
    case "expense_report":
      return `📊 Como ver quanto você já gastou:

É só perguntar, do jeito que quiser.

Exemplos:
• "quanto gastei esse mês"
• "quanto gastei essa semana"
• "últimos 15 dias quanto gastei em mercado"

Eu também mando um resumo automático toda semana e todo mês, sem você precisar pedir.`;
    case "edit_expense":
      return `✏️ Como corrigir um gasto que você já registrou:

Primeiro, peça pra ver a lista, dizendo por exemplo "quais gastos eu tive hoje".

Eu mostro os gastos numerados. Depois, é só dizer o que mudar usando o número, tipo "muda o valor do 2 pra 45".

Também dá pra descrever o gasto direto, sem ver a lista antes: "a farmácia foi no pix, não em dinheiro".`;
    case "category":
      return `🏷️ Como funcionam as categorias:

São os grupos que organizam seus gastos, tipo "Mercado", "Saúde", "Lazer". Eu já crio algumas prontas e vou aprendendo com o tempo.

Pra ver quais você tem: "quais categorias eu tenho"

Pra corrigir a categoria de um gasto: "muda a categoria do mercado pra lazer"`;
    case "payment_method":
      return `💳 Como definir a forma de pagamento:

Você pode dizer qual usou na hora de registrar o gasto, tipo "50 no mercado no pix".

Se não disser nada, eu uso a sua forma padrão. Pra definir ou mudar qual é a padrão: "meu pagamento padrão é pix"`;
    default:
      return null;
  }
}

// Formato do evento "messages.upsert" da Evolution API. O campo com o audio/imagem
// em base64 pode vir em lugares diferentes dependendo da versao/config da API — e em
// algumas versoes nao vem de jeito nenhum no payload do webhook (so uma referencia
// criptografada), sendo preciso buscar via getBase64FromMediaMessage (ver resolveMediaBase64).
interface EvolutionMessage {
  key: { remoteJid: string; id: string; fromMe: boolean };
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

async function resolveMediaBase64(data: EvolutionMessage): Promise<string | undefined> {
  const inline = data.message?.base64 ?? data.base64;
  if (inline) return inline;
  try {
    const fetched = await getBase64FromMediaMessage({
      remoteJid: data.key.remoteJid,
      id: data.key.id,
      fromMe: data.key.fromMe,
    });
    return fetched.base64;
  } catch (err) {
    console.error("Erro ao buscar midia via getBase64FromMediaMessage:", err);
    return undefined;
  }
}

const WELCOME_MESSAGE = `👋 Oi! Eu sou seu assistente pessoal aqui no WhatsApp. Te ajudo a controlar gastos, agenda e lembretes.

É bem simples: me conte o que precisar, do jeito que você fala naturalmente. Alguns exemplos:

💰 "gastei 50 reais no mercado" — registro o gasto
📅 "marca dentista amanhã 15h" — agendo o compromisso
⏰ "me lembra de tomar remédio às 20h" — crio um lembrete

Se tiver qualquer dúvida, é só perguntar, tipo "como faço pra editar um gasto" — eu explico com exemplo.`;

export async function handleIncomingMessage(data: EvolutionMessage) {
  const from = data.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");

  // Cada numero tem categorias/formas de pagamento proprias, isoladas dos demais;
  // na primeira mensagem desse numero, cria as categorias/formas padrao pra ele.
  const isNewUser = ensureUserSeeded(from);
  if (isNewUser) {
    logActivity(from, "welcome", "primeira mensagem desse numero");
    await sendText(from, WELCOME_MESSAGE);
  }

  let text: string | undefined;
  if (data.messageType === "conversation" || data.messageType === "extendedTextMessage") {
    text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
  } else if (data.messageType === "audioMessage") {
    const audioBase64 = await resolveMediaBase64(data);
    if (audioBase64) text = await transcribeAudio(Buffer.from(audioBase64, "base64"));
  }

  // Enquanto tiver categorizacao pendente pra esse numero, a proxima mensagem
  // de texto/audio e tratada como resposta a "qual categoria e isso?", nao como pedido novo.
  if (text !== undefined) {
    const pending = getNextPendingCategorization(from);
    if (pending) {
      await resolvePendingCategorization(from, pending, text);
      return;
    }

    const pendingChoice = getPendingListChoice(from);
    if (pendingChoice) {
      await resolveListChoice(from, pendingChoice.days, text);
      return;
    }

    const pendingDeletion = getPendingEventDeletion(from);
    if (pendingDeletion) {
      await resolveEventDeletionConfirmation(from, pendingDeletion, text);
      return;
    }
  }

  let interpretations: Interpretation[];
  if (text !== undefined) {
    interpretations = await interpretText(from, text);
  } else if (data.messageType === "imageMessage") {
    const imageBase64 = await resolveMediaBase64(data);
    if (!imageBase64) {
      await sendText(from, "Não consegui baixar essa imagem. Tenta mandar de novo?");
      return;
    }
    const mimeType = data.message?.imageMessage?.mimetype ?? "image/jpeg";
    interpretations = await interpretReceiptImage(from, imageBase64, mimeType);
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

    const created = insertExpense({
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
    setPendingUndo(from, {
      kind: "delete_expense",
      expenseId: created.id,
      description: `R$${pending.amount.toFixed(2)} em ${category.name} — ${pending.description}`,
    });
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

// gastos individuais de mais de 1 dia, agrupados por dia com um cabecalho — mas
// numerados em sequencia unica (1, 2, 3...) pra "edita o 2" continuar funcionando
// independente de qual dia o item 2 seja.
function buildGroupedExpenseListText(items: ExpenseListItem[], label: string): string {
  const days: string[] = [];
  const byDay = new Map<string, ExpenseListItem[]>();
  for (const item of items) {
    const day = item.date.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, []);
      days.push(day);
    }
    byDay.get(day)!.push(item);
  }

  let counter = 0;
  const sections = days.map((day) => {
    const lines = byDay.get(day)!.map((item) => {
      counter += 1;
      const details = [item.category ?? "sem categoria", item.payment_method].filter(Boolean).join(", ");
      return `${counter}. R$${item.amount.toFixed(2)} — ${item.description} (${details})`;
    });
    return `📅 ${formatDateOnly(day)}\n${lines.join("\n")}`;
  });

  return `🧾 Gastos — ${label}\n\n${sections.join("\n\n")}\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45" ou "o 2 foi no pix".`;
}

// resposta a "resumo por categoria ou detalhado por dia?" — se nao der pra saber
// qual das duas, pergunta de novo em vez de escolher por conta propria
async function resolveListChoice(from: string, days: number, answerText: string) {
  const normalized = answerText.toLowerCase();
  const wantsSummary = /resum|categor|total/.test(normalized);
  const wantsDetailed = /detalh|separad|individual|descrit|dia a dia/.test(normalized);

  if (wantsSummary === wantsDetailed) {
    await sendText(from, 'Não entendi — quer o *resumo por categoria* ou o *detalhado* por dia? Responde "resumo" ou "detalhado".');
    return;
  }

  clearPendingListChoice(from);
  const range = lastNDaysRange(days);

  if (wantsSummary) {
    logActivity(from, "expense_report", range.label);
    await sendText(from, buildExpenseReportText(range, { fromNumber: from }));
    return;
  }

  const items = getExpensesBetween(from, range.start, range.end);
  if (!items.length) {
    logActivity(from, "list_expenses", `nenhum gasto em ${range.label}`);
    await sendText(from, `Nenhum gasto registrado em ${range.label}.`);
    return;
  }
  setLastShownExpenses(from, items.map((item) => item.id));
  logActivity(from, "list_expenses", `${items.length} gasto(s) em ${range.label} (detalhado)`);
  await sendText(from, buildGroupedExpenseListText(items, range.label));
}

// resposta a "confirma que quer cancelar o evento X?" -- so exclui de verdade
// com um "sim" claro; resposta ambigua pergunta de novo em vez de assumir
async function resolveEventDeletionConfirmation(from: string, pending: { eventId: number; title: string }, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — quer mesmo cancelar o evento "${pending.title}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingEventDeletion(from);
  if (no) {
    logActivity(from, "delete_event", `cancelamento de "${pending.title}" nao confirmado`);
    await sendText(from, `Beleza, não mexi em nada — "${pending.title}" continua na agenda.`);
    return;
  }

  const fullEvent = getEventById(from, pending.eventId);
  deleteEvent(from, pending.eventId);
  if (fullEvent) {
    setPendingUndo(from, {
      kind: "recreate_event",
      params: {
        fromNumber: from,
        title: fullEvent.title,
        start: fullEvent.start,
        end: fullEvent.end,
        location: fullEvent.location ?? undefined,
        reminderMinutes: fullEvent.reminder_minutes,
      },
      description: fullEvent.title,
    });
  }
  logActivity(from, "delete_event", `confirmado: removido "${pending.title}"`);
  await sendText(from, `🗑️ Evento "${pending.title}" removido da agenda.`);
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
        const created = insertExpense({
          fromNumber: from,
          amount: interpretation.amount,
          description,
          categoryId: category.id,
          paymentMethodId: paymentMethod?.id ?? null,
          date,
        });
        const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
        setPendingUndo(from, {
          kind: "delete_expense",
          expenseId: created.id,
          description: `R$${interpretation.amount.toFixed(2)} em ${category.name} — ${description}`,
        });
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
      const previousCategoryId = expense.category_id;
      updateExpenseCategory(expense.id, category.id);
      learnKeyword(from, expense.description, category.id);
      if (previousCategoryId != null) {
        setPendingUndo(from, {
          kind: "restore_category",
          expenseId: expense.id,
          previousCategoryId,
          description: expense.description,
        });
      }
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
      setPendingUndo(from, { kind: "delete_event", eventId: created.id, description: interpretation.title });
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
        setPendingEventDeletion(from, event.id, event.title);
        logActivity(from, "delete_event", `pediu confirmacao pra cancelar "${event.title}"`);
        await sendText(
          from,
          `Encontrei "${event.title}" em ${formatDateTime(event.start)}. Confirma que quer cancelar? Responde "sim" ou "não".`
        );
      } else {
        const list = matches.map((e) => `• ${e.title} — ${formatDateTime(e.start)}`).join("\n");
        logActivity(from, "delete_event", `${matches.length} eventos parecidos com "${interpretation.query}", pedi pra especificar`);
        await sendText(from, `Achei mais de um evento parecido com "${interpretation.query}":\n${list}\n\nMe diga o nome mais específico de qual quer cancelar.`);
      }
      break;
    }
    case "reminder": {
      const reminderId = createReminder(from, interpretation.message, interpretation.due_at);
      setPendingUndo(from, { kind: "delete_reminder", reminderId, description: interpretation.message });
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
      // periodo de mais de 1 dia: pergunta se quer o resumo por categoria (como
      // era antes) ou o detalhado, gasto a gasto separado por dia, em vez de
      // decidir por conta propria
      if (interpretation.days && interpretation.days > 1) {
        setPendingListChoice(from, interpretation.days);
        logActivity(from, "list_expenses", `perguntou formato pros ultimos ${interpretation.days} dias`);
        await sendText(
          from,
          `Você quer o *resumo por categoria* (com o total, como antes) ou o *detalhado*, com cada gasto separado por dia? Responde "resumo" ou "detalhado".`
        );
        break;
      }

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
      setPendingUndo(from, {
        kind: "restore_expense",
        expenseId: expense.id,
        previous: {
          amount: expense.amount,
          description: expense.description,
          date: expense.date,
          categoryId: expense.category_id,
          paymentMethodId: expense.payment_method_id,
        },
        description: expense.description,
      });
      logActivity(from, "edit_expense", `#${expense.id} ${expense.description}: ${changeText}`);
      await sendText(from, `✏️ Gasto "${expense.description}" atualizado: ${changeText}`);
      break;
    }
    case "undo": {
      const undo = getPendingUndo(from);
      if (!undo) {
        logActivity(from, "undo", "nada pendente pra desfazer");
        await sendText(from, "Não tem nada recente pra eu desfazer.");
        break;
      }
      clearPendingUndo(from);
      switch (undo.kind) {
        case "delete_expense":
          deleteExpense(from, undo.expenseId);
          logActivity(from, "undo", `gasto removido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: gasto de ${undo.description} removido.`);
          break;
        case "restore_expense":
          updateExpense(from, undo.expenseId, undo.previous);
          logActivity(from, "undo", `gasto revertido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz a última alteração em "${undo.description}".`);
          break;
        case "restore_category":
          updateExpenseCategory(undo.expenseId, undo.previousCategoryId);
          logActivity(from, "undo", `categoria revertida: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: categoria de "${undo.description}" voltou como estava.`);
          break;
        case "delete_event":
          deleteEvent(from, undo.eventId);
          logActivity(from, "undo", `evento removido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: evento "${undo.description}" removido da agenda.`);
          break;
        case "recreate_event":
          createEvent(undo.params);
          logActivity(from, "undo", `evento recriado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, "${undo.description}" voltou pra agenda.`);
          break;
        case "delete_reminder":
          deleteReminder(from, undo.reminderId);
          logActivity(from, "undo", `lembrete removido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: lembrete "${undo.description}" removido.`);
          break;
      }
      break;
    }
    case "help": {
      const topicMessage = helpTopicMessage(interpretation.topic);
      if (topicMessage) {
        logActivity(from, "help", `explicou o topico "${interpretation.topic}"`);
        await sendText(from, topicMessage);
        break;
      }
      logActivity(from, "help", "explicou funcionalidades");
      await sendText(
        from,
        `🤖 O que eu faço:

💰 *Gastos*
Registre por texto, áudio ou foto do comprovante. Eu categorizo sozinho (e pergunto se não souber). Diga "editar compras de ontem" pra corrigir algo, ou "quanto gastei esse mês" pra um resumo.

📅 *Agenda e lembretes*
"Marca dentista amanhã 15h", "cancela a reunião de sexta", "me lembra de pagar a internet dia 10". Aviso automático antes de cada evento.

🎯 *Orçamento*
"Me avisa se eu passar de R$300 em mercado" — eu aviso quando chegar perto ou passar.

📊 *Relatórios*
Automáticos (semanal + mensal) ou sob demanda, tipo "gastos dos últimos 15 dias em lazer".

Manda uma dessas mensagens que eu entendo 🙂`
      );
      break;
    }
    default: {
      logActivity(from, "unknown", interpretation.description ?? "nao classificado");
      await sendText(from, unknownFollowUp(interpretation.likely_intent));
    }
  }
}
