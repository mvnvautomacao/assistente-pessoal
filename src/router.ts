import { sendText, getBase64FromMediaMessage } from "./whatsapp/client";
import { transcribeAudio } from "./ai/transcribe";
import {
  interpretText,
  interpretReceiptImage,
  extractCategoryFromAnswer,
  extractDateTimeFromAnswer,
  extractExpenseInfoFromAnswer,
  extractInstallmentInfoFromAnswer,
  Interpretation,
} from "./ai/interpret";
import {
  createEvent,
  findUpcomingEvents,
  deleteEvent,
  updateEvent,
  listUpcomingEvents,
  getEventById,
  getEventsForMonth,
} from "./events/service";
import {
  createReminder,
  getRemindersWithinDays,
  getRemindersForMonth,
  deleteReminder,
  updateReminder,
  findPendingRemindersByText,
} from "./reminders/service";
import { setPendingEditEvent, getPendingEditEvent, clearPendingEditEvent, PendingEditEvent } from "./events/pendingEditEvent";
import {
  setPendingEditReminder,
  getPendingEditReminder,
  clearPendingEditReminder,
  PendingEditReminder,
} from "./reminders/pendingEditReminder";
import { setPendingRemoveBudget, getPendingRemoveBudget, clearPendingRemoveBudget, PendingRemoveBudget } from "./expenses/pendingRemoveBudget";
import {
  setPendingRemoveRecurring,
  getPendingRemoveRecurring,
  clearPendingRemoveRecurring,
  PendingRemoveRecurring,
} from "./expenses/pendingRemoveRecurring";
import { currentWeekRange, currentMonthRange, lastNDaysRange, singleDayRange, buildExpenseReportText } from "./expenses/reportText";
import { setBudget, removeBudget, getBudget, listBudgets, checkBudgetAlert } from "./expenses/budgets";
import { setLastShownExpenses, getLastShownExpenses, clearLastShownExpenses } from "./expenses/listCache";
import { setPendingListChoice, getPendingListChoice, clearPendingListChoice } from "./expenses/pendingListChoice";
import {
  setPendingBulkRecategorize,
  getPendingBulkRecategorize,
  clearPendingBulkRecategorize,
  PendingBulkRecategorize,
} from "./expenses/pendingBulkRecategorize";
import {
  setPendingMergeCategories,
  getPendingMergeCategories,
  clearPendingMergeCategories,
  PendingMergeCategories,
} from "./expenses/pendingMergeCategories";
import {
  setPendingEditExpense,
  getPendingEditExpense,
  clearPendingEditExpense,
  PendingEditExpense,
  EditExpenseParams,
} from "./expenses/pendingEditExpense";
import {
  setPendingCorrectCategory,
  getPendingCorrectCategory,
  clearPendingCorrectCategory,
  PendingCorrectCategory,
} from "./expenses/pendingCorrectCategory";
import {
  createRecurringExpense,
  listRecurringExpenses,
  findActiveRecurringExpenseByDescription,
  deactivateRecurringExpense,
} from "./expenses/recurring";
import { insertIncome, deleteIncome, getIncomeSummaryBetween } from "./incomes/service";
import { setPendingEventDeletion, getPendingEventDeletion, clearPendingEventDeletion } from "./events/pendingDeletion";
import { setPendingUndo, getPendingUndo, clearPendingUndo } from "./undo/pendingUndo";
import {
  addPendingCompletion,
  getNextPendingCompletion,
  updatePendingCompletionHead,
  clearHeadPendingCompletion,
  PendingCompletion,
} from "./completion/pendingCompletion";
import { logActivity } from "./activity/service";
import { isNumberAllowed } from "./access/allowlist";
import { isRateLimited, recordMessageAndCheckLimit } from "./access/rateLimit";
import { shouldAlertOwner } from "./access/ownerAlert";
import { config } from "./config";
import { spDateString, ensureBrazilOffset } from "./timeSP";
import {
  ensureUserSeeded,
  findCategoryByName,
  findCategoryByKeyword,
  findCategoryMentionedIn,
  getOrCreateCategory,
  getCategoryById,
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
  getRecentExpensesList,
  getExpensesByCategoryId,
  bulkUpdateExpenseCategory,
  searchExpenses,
  deleteCategory,
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

// "2026-08-20" -> "2026-08-21". Sempre em Date.UTC (nunca new Date(dateString)
// puro), pra nao cair na mesma cilada de fuso horario do comentario acima.
function addOneDayToDateString(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Soma N meses a uma data-calendario pura (compra parcelada: cada parcela cai
// no mesmo dia, N meses depois). Se o dia nao existir no mes de destino (ex:
// dia 31 e o mes seguinte so tem 30), cai no ultimo dia daquele mes em vez de
// estourar pro mes seguinte (Date.UTC normalizaria "31 de fevereiro" pra
// marco, o que empurraria a parcela pro mes errado).
function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(y, targetMonthIndex, day)).toISOString().slice(0, 10);
}

// "2026-11" -> "novembro de 2026", pro relatorio de agenda de um mes especifico.
// Date.UTC + timeZone:"UTC" evita reprojecao de fuso (o mes/ano nao dependem de hora).
function monthLabelPt(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Combina uma nova data e/ou hora com uma string ISO existente, mantendo a
// parte que NAO foi informada (ex: "muda so o dia" nao pode apagar a hora
// original). existingIso sempre tem o offset -03:00 explicito (ver
// ensureBrazilOffset), entao os primeiros 10/5 caracteres JA SAO a data/hora
// em horario de Brasilia -- string-slice direto, sem passar por Date (evita
// qualquer risco de reprojecao de fuso).
function mergeDateTime(existingIso: string, newDate?: string, newTime?: string): string {
  const date = newDate ?? existingIso.slice(0, 10);
  const time = newTime ?? existingIso.slice(11, 16);
  return ensureBrazilOffset(`${date}T${time}:00`);
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
  topic?:
    | "expense"
    | "event"
    | "reminder"
    | "budget"
    | "expense_report"
    | "edit_expense"
    | "category"
    | "payment_method"
    | "welcome"
    | "recurring_expense"
    | "income"
): string | null {
  switch (topic) {
    case "welcome":
      return WELCOME_MESSAGE;
    case "income":
      return `💵 Como registrar uma entrada de dinheiro (salário, freela, reembolso...):

É parecido com registrar um gasto, só que pro lado que entra dinheiro.

Exemplo: "recebi 3000 reais de salário"

Pra saber quanto entrou: "quanto recebi esse mês"

Pra ver o que sobrou (entradas menos gastos): "qual meu saldo esse mês"`;
    case "recurring_expense":
      return `🔁 Como cadastrar um gasto fixo (que se repete todo mês):

Diga o valor, do que é e o dia do mês em que costuma pagar.

Exemplo: "todo dia 10 pago 50 reais de internet"

A partir daí, todo mês eu lanço esse gasto sozinho, no dia certo, sem você precisar mandar mensagem de novo.

Pra ver quais você já tem: "quais gastos fixos eu tenho"

Pra parar de lançar um: "cancela o gasto fixo da internet"`;
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

Eu aviso você um tempo antes do horário chegar, pra não esquecer. Pra cancelar, é só dizer, tipo "cancela a consulta do dia 15". Pra mudar só o dia/horário sem cancelar: "remarca a consulta pra sexta às 16h" — eu confirmo antes de aplicar.`;
    case "reminder":
      return `⏰ Como criar um lembrete:

Diga o que você quer lembrar e quando.

Exemplo: "me lembra de tomar remédio às 20h"

Na hora certa eu mando uma mensagem avisando. Pra mudar o horário de um lembrete já criado: "muda o lembrete do remédio pra amanhã às 21h" — eu confirmo antes de aplicar.`;
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

Também dá pra descrever o gasto direto, sem ver a lista antes: "a farmácia foi no pix, não em dinheiro".

Antes de mudar de verdade, eu sempre confirmo com você mostrando o que vai virar o quê — se eu errar, é só me dizer o valor certo antes de confirmar.`;
    case "category":
      return `🏷️ Como funcionam as categorias:

São os grupos que organizam seus gastos, tipo "Mercado", "Saúde", "Lazer". Eu já crio algumas prontas e vou aprendendo com o tempo — geralmente nem precisa criar na mão, elas surgem conforme você registra os gastos.

Mas se quiser criar uma categoria nova de propósito: "cria uma categoria chamada Pets"

Pra ver quais você tem: "quais categorias eu tenho"

Pra corrigir a categoria de UM gasto: "muda a categoria do mercado pra lazer"

Pra mudar VÁRIOS de uma vez: "muda os gastos de hoje pra lazer", "muda os últimos 5 gastos pra mercado", "muda os gastos de 10 a 20 desse mês pra lazer", ou "muda todo gasto com ifood na descrição pra alimentação"

Pra juntar duas categorias numa só (a de origem deixa de existir): "junta a categoria Mercado com Supermercado"`;
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

// preview curto do que o numero bloqueado mandou, so pra dar contexto no /admin
// na hora de decidir se libera ou nao — nunca baixa midia (imagem/audio) so pra isso.
function blockedMessagePreview(data: EvolutionMessage): string {
  if (data.messageType === "conversation" || data.messageType === "extendedTextMessage") {
    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
    return text.slice(0, 150) || "(vazio)";
  }
  if (data.messageType === "audioMessage") return "[áudio]";
  if (data.messageType === "imageMessage") return "[imagem]";
  return `[${data.messageType}]`;
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
  // Mensagem de grupo (JID termina em @g.us): nunca processa, incondicional --
  // mesmo que alguem aprove um grupo por engano no /admin, essa checagem
  // independente evita o bot responder pra varias pessoas de uma vez.
  if (data.key.remoteJid.endsWith("@g.us")) return;

  const from = data.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");

  // Numero nao autorizado: ignora em silencio, sem mandar nada de volta. Evita
  // loop de bot conversando com bot de outra empresa (ja aconteceu em producao).
  // Liberar numeros novos no /admin. Avisa o dono (uma vez por hora por numero,
  // ver ownerAlert.ts) pra ele saber na hora em vez de descobrir depois.
  if (!isNumberAllowed(from)) {
    const preview = blockedMessagePreview(data);
    logActivity(from, "blocked", `mensagem bloqueada (numero nao autorizado): ${preview}`);
    if (shouldAlertOwner(`blocked:${from}`)) {
      await sendText(
        config.myWhatsappNumber,
        `🚨 Número não autorizado tentou falar comigo: ${from}\nMensagem: "${preview}"\n\nSe for legítimo, aprove em /admin.`
      ).catch((err) => console.error("Erro ao avisar o dono sobre numero bloqueado:", err));
    }
    return;
  }

  // Freio de emergencia: numero ja autorizado mandando mensagens rapido demais
  // (loop de outro tipo, script travado etc) tambem pausa, pra nunca gastar API
  // sem limite. Ver rateLimit.ts.
  if (isRateLimited(from)) return;
  if (recordMessageAndCheckLimit(from)) {
    logActivity(from, "rate_limited", "mais de 20 mensagens em 5 min -- pausado por 30 min");
    await sendText(from, "Você mandou muitas mensagens muito rápido. Vou pausar por 30 min pra não sobrecarregar. Se não foi você, pode ignorar.").catch(
      (err) => console.error("Erro ao avisar numero sobre rate limit:", err)
    );
    if (shouldAlertOwner(`rate_limited:${from}`)) {
      await sendText(
        config.myWhatsappNumber,
        `🚨 Número ${from} mandou muitas mensagens muito rápido (possível loop) e foi pausado por 30 min.`
      ).catch((err) => console.error("Erro ao avisar o dono sobre rate limit:", err));
    }
    return;
  }

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

    const pendingCompletion = getNextPendingCompletion(from);
    if (pendingCompletion) {
      await resolvePendingCompletion(from, pendingCompletion, text);
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

    const pendingBulkRecat = getPendingBulkRecategorize(from);
    if (pendingBulkRecat) {
      await resolveBulkRecategorizeConfirmation(from, pendingBulkRecat, text);
      return;
    }

    const pendingMerge = getPendingMergeCategories(from);
    if (pendingMerge) {
      await resolveMergeCategoriesConfirmation(from, pendingMerge, text);
      return;
    }

    const pendingEditExpense = getPendingEditExpense(from);
    if (pendingEditExpense) {
      await resolveEditExpenseConfirmation(from, pendingEditExpense, text);
      return;
    }

    const pendingCorrectCategory = getPendingCorrectCategory(from);
    if (pendingCorrectCategory) {
      await resolveCorrectCategoryConfirmation(from, pendingCorrectCategory, text);
      return;
    }

    const pendingEditEvent = getPendingEditEvent(from);
    if (pendingEditEvent) {
      await resolveEditEventConfirmation(from, pendingEditEvent, text);
      return;
    }

    const pendingEditReminder = getPendingEditReminder(from);
    if (pendingEditReminder) {
      await resolveEditReminderConfirmation(from, pendingEditReminder, text);
      return;
    }

    const pendingRemoveBudget = getPendingRemoveBudget(from);
    if (pendingRemoveBudget) {
      await resolveRemoveBudgetConfirmation(from, pendingRemoveBudget, text);
      return;
    }

    const pendingRemoveRecurring = getPendingRemoveRecurring(from);
    if (pendingRemoveRecurring) {
      await resolveRemoveRecurringConfirmation(from, pendingRemoveRecurring, text);
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

// Cria o gasto de verdade (ou entra na fila de categorizacao se nao souber a
// categoria). Extraido do case "expense" pra ser reaproveitado tambem quando
// um gasto parcial (faltando valor ou descricao) termina de ser completado.
async function createExpenseAndNotify(
  from: string,
  params: { amount: number; description: string; date: string; category?: string; payment_method?: string }
) {
  const keywordHints = [params.category, params.description].filter((hint): hint is string => Boolean(hint));
  const category = (params.category && findCategoryByName(from, params.category)) || findCategoryByKeyword(from, ...keywordHints);

  if (category) {
    const paymentMethod = resolvePaymentMethod(from, params.payment_method);
    const created = insertExpense({
      fromNumber: from,
      amount: params.amount,
      description: params.description,
      categoryId: category.id,
      paymentMethodId: paymentMethod?.id ?? null,
      date: params.date,
    });
    const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
    setPendingUndo(from, {
      kind: "delete_expense",
      expenseId: created.id,
      description: `R$${params.amount.toFixed(2)} em ${category.name} — ${params.description}`,
    });
    logActivity(from, "expense", `R$${params.amount.toFixed(2)} em ${category.name}${paymentSuffix} — ${params.description}`);
    const budgetAlert = checkBudgetAlert(from, category.id, category.name) ?? "";
    await sendText(
      from,
      `✅ Gasto registrado: R$${params.amount.toFixed(2)} em ${category.name} — ${params.description}${paymentSuffix}${budgetAlert}`
    );
  } else {
    // se ja tem pendencia(s) na fila, so entra na fila; a pergunta em si so
    // sai quando chega a vez dele (ver resolvePendingCategorization)
    const alreadyWaiting = getNextPendingCategorization(from) !== null;
    addPendingCategorization({
      from_number: from,
      amount: params.amount,
      description: params.description,
      date: params.date,
      suggested_category: params.category ?? null,
      suggested_payment_method: params.payment_method ?? null,
    });
    logActivity(from, "expense", `pendente de categoria: R$${params.amount.toFixed(2)} — ${params.description}`);
    if (!alreadyWaiting) await askForCategory(from, params.amount, params.description);
  }
}

// Cria o evento de verdade. Extraido do case "event" pra ser reaproveitado
// tambem quando um evento parcial (faltando dia e/ou horario) termina de ser
// completado (ver resolvePendingCompletion).
async function createEventAndNotify(from: string, params: { title: string; start: string; end?: string; location?: string }) {
  // a IA/o merge devolve o horario em hora local de Brasilia mas nem sempre
  // com o offset explicito -03:00; sem isso, o resto do sistema pode tratar
  // como UTC e adiantar o evento em 3h (ver ensureBrazilOffset em timeSP.ts)
  const start = ensureBrazilOffset(params.start);
  const end = params.end ? ensureBrazilOffset(params.end) : undefined;
  const created = createEvent({ fromNumber: from, title: params.title, start, end, location: params.location });
  setPendingUndo(from, { kind: "delete_event", eventId: created.id, description: params.title });
  logActivity(from, "event", `${params.title} — ${start}`);
  await sendText(from, `📅 Evento "${params.title}" criado na agenda em ${formatDateTime(start)} (aviso ${created.reminder_minutes} min antes)`);
}

// Cria o lembrete de verdade. Extraido do case "reminder" pra ser reaproveitado
// tambem quando um lembrete parcial termina de ser completado.
async function createReminderAndNotify(from: string, params: { message: string; due_at: string }) {
  const dueAt = ensureBrazilOffset(params.due_at);
  const reminderId = createReminder(from, params.message, dueAt);
  setPendingUndo(from, { kind: "delete_reminder", reminderId, description: params.message });
  logActivity(from, "reminder", `${params.message} — ${dueAt}`);
  await sendText(from, `⏰ Lembrete criado: "${params.message}" — vou avisar em ${formatDateTime(dueAt)}`);
}

function missingDateTimeParts(date?: string, time?: string): Array<"date" | "time"> {
  const missing: Array<"date" | "time"> = [];
  if (!date) missing.push("date");
  if (!time) missing.push("time");
  return missing;
}

function missingExpenseParts(amount?: number, description?: string): Array<"amount" | "description"> {
  const missing: Array<"amount" | "description"> = [];
  if (amount === undefined) missing.push("amount");
  if (!description) missing.push("description");
  return missing;
}

// "category" nao entra aqui de proposito -- so e descoberta faltando na hora
// de finalizar (ver finalizeInstallmentExpense), depois que o resto ja foi
// resolvido, igual acontece com um gasto avulso normal.
function missingInstallmentParts(
  totalAmount?: number,
  installmentAmount?: number,
  description?: string,
  installments?: number
): Array<"amount" | "description" | "installments"> {
  const missing: Array<"amount" | "description" | "installments"> = [];
  if (totalAmount === undefined && installmentAmount === undefined) missing.push("amount");
  if (!description) missing.push("description");
  if (installments === undefined || installments < 1) missing.push("installments");
  return missing;
}

// Calcula o valor de cada parcela. Se o usuario deu o valor de cada parcela
// direto, so repete (sem erro de arredondamento possivel). Se deu o valor
// TOTAL, divide igualmente e ajusta a ULTIMA parcela pra absorver a sobra de
// centavos (mesma logica que a fatura do cartao usa), pra soma bater exato
// com o total informado.
function computeInstallmentAmounts(totalAmount: number | undefined, installmentAmount: number | undefined, installments: number): number[] {
  if (installmentAmount !== undefined) {
    return Array.from({ length: installments }, () => Math.round(installmentAmount * 100) / 100);
  }
  const total = totalAmount ?? 0;
  const base = Math.round((total / installments) * 100) / 100;
  const amounts = Array.from({ length: installments }, () => base);
  const roundedSum = Math.round(base * (installments - 1) * 100) / 100;
  amounts[installments - 1] = Math.round((total - roundedSum) * 100) / 100;
  return amounts;
}

// Cria as N parcelas de verdade (uma por mes, mesmo dia da compra, a partir de
// 'date'). So cria se a categoria for conhecida -- devolve false sem criar
// nada se nao for, pra quem chamou decidir se pergunta a categoria (mesma
// ideia do resto do fluxo de completude). 'forceCategory' e usado quando o
// nome veio de uma resposta EXPLICITA do usuario a essa pergunta (aí cria a
// categoria se for nova, igual acontece numa categorizacao manual normal).
async function finalizeInstallmentExpense(
  from: string,
  params: {
    description: string;
    category?: string;
    payment_method?: string;
    date: string;
    totalAmount?: number;
    installmentAmount?: number;
    installments: number;
  },
  options?: { forceCategory?: boolean }
): Promise<boolean> {
  const keywordHints = [params.category, params.description].filter((hint): hint is string => Boolean(hint));
  const category =
    options?.forceCategory && params.category
      ? getOrCreateCategory(from, params.category)
      : (params.category && findCategoryByName(from, params.category)) || findCategoryByKeyword(from, ...keywordHints);
  if (!category) return false;

  const amounts = computeInstallmentAmounts(params.totalAmount, params.installmentAmount, params.installments);
  const paymentMethod = resolvePaymentMethod(from, params.payment_method);
  const expenseIds: number[] = [];
  for (let i = 0; i < params.installments; i++) {
    const created = insertExpense({
      fromNumber: from,
      amount: amounts[i],
      description: `${params.description} (parcela ${i + 1}/${params.installments})`,
      categoryId: category.id,
      paymentMethodId: paymentMethod?.id ?? null,
      date: addMonthsToDateString(params.date, i),
    });
    expenseIds.push(created.id);
  }

  const total = amounts.reduce((sum, a) => sum + a, 0);
  const paymentSuffix = paymentMethod ? ` via ${paymentMethod.name}` : "";
  const lastLabel = amounts[0] !== amounts[params.installments - 1] ? ` (última R$${amounts[params.installments - 1].toFixed(2)})` : "";
  setPendingUndo(from, {
    kind: "delete_expenses_bulk",
    expenseIds,
    description: `${params.description} parcelado em ${params.installments}x`,
  });
  logActivity(
    from,
    "installment_expense",
    `${params.description} — R$${total.toFixed(2)} em ${params.installments}x (${category.name}${paymentSuffix})`
  );
  await sendText(
    from,
    `✅ Compra parcelada registrada: "${params.description}" — R$${total.toFixed(2)} em ${params.installments}x de R$${amounts[0].toFixed(2)}${lastLabel} em ${category.name}${paymentSuffix}, lançada de ${formatDateOnly(params.date)} até ${formatDateOnly(addMonthsToDateString(params.date, params.installments - 1))}.`
  );
  return true;
}

function installmentCategoryQuestionText(from: string, params: { description?: string; installments?: number; totalAmount?: number; installmentAmount?: number }): string {
  const categoryNames = listCategories(from)
    .map((c) => c.name)
    .join(", ");
  const total =
    params.totalAmount ?? (params.installmentAmount !== undefined && params.installments ? params.installmentAmount * params.installments : undefined);
  const amountLabel = total !== undefined ? `R$${total.toFixed(2)}` : "";
  const installmentsLabel = params.installments ? ` em ${params.installments}x` : "";
  return `Qual categoria é essa compra parcelada${amountLabel ? ` de ${amountLabel}` : ""}${installmentsLabel} (${params.description})?\n\nCategorias: ${categoryNames}\n\nPode responder com uma dessas ou dizer uma categoria nova.`;
}

// Monta a pergunta (ou o "nao entendi, de novo") pro item da vez na fila de
// completude -- pergunta so o que falta, citando o que ja ficou sabido, pra
// nao obrigar o usuario a repetir a mensagem toda.
function pendingCompletionQuestionText(from: string, pending: PendingCompletion, retry = false): string {
  const prefix = retry ? "Não entendi — " : "Beleza, ";
  if (pending.intent === "event" || pending.intent === "reminder") {
    const label = pending.intent === "event" ? `"${pending.title}"` : `o lembrete "${pending.message}"`;
    const missingDate = pending.missing.includes("date");
    const missingTime = pending.missing.includes("time");
    if (missingDate && missingTime) return `${prefix}${label}! Pra quando? Me diga o dia e o horário — ex: "sexta às 15h".`;
    if (missingDate) return `${prefix}${label} às ${pending.time}! Pra que dia?`;
    return `${prefix}${label} pra ${formatDateOnly(pending.date!)}! Que horas?`;
  }
  if (pending.intent === "installment_expense") {
    if (pending.missing.includes("category")) {
      return retry ? `Não entendi — ${installmentCategoryQuestionText(from, pending)}` : installmentCategoryQuestionText(from, pending);
    }
    const missingAmount = pending.missing.includes("amount");
    const missingDescription = pending.missing.includes("description");
    const missingInstallments = pending.missing.includes("installments");
    const asks: string[] = [];
    if (missingDescription) asks.push("do que foi");
    if (missingAmount) asks.push("o valor total");
    if (missingInstallments) asks.push("em quantas vezes");
    const askText = asks.length > 1 ? `${asks.slice(0, -1).join(", ")} e ${asks[asks.length - 1]}` : asks[0];
    const label = pending.description ? `"${pending.description}"` : "essa compra parcelada";
    const amountLabel =
      pending.totalAmount !== undefined
        ? ` de R$${pending.totalAmount.toFixed(2)}`
        : pending.installmentAmount !== undefined
          ? ` de R$${pending.installmentAmount.toFixed(2)} cada parcela`
          : "";
    const installmentsLabel = pending.installments !== undefined ? ` em ${pending.installments}x` : "";
    return `${prefix}${label}${amountLabel}${installmentsLabel}! Me diga ${askText}.`;
  }
  const missingAmount = pending.missing.includes("amount");
  const missingDescription = pending.missing.includes("description");
  if (missingAmount && missingDescription) return `${prefix}um gasto! Me diga o valor e do que foi.`;
  if (missingAmount) return `${prefix}gasto de "${pending.description}"! Quanto foi?`;
  return `${prefix}um gasto de R$${pending.amount!.toFixed(2)}! Do que foi?`;
}

async function askNextPendingCompletionIfAny(from: string) {
  const next = getNextPendingCompletion(from);
  if (next) await sendText(from, pendingCompletionQuestionText(from, next));
}

// Resposta a "pra quando?"/"quanto foi?" de um evento/lembrete/gasto que veio
// incompleto na mensagem original (ver maybeStartPendingCompletion). Extrai so
// o(s) campo(s) que a resposta trouxe e mescla com o que ja era conhecido --
// se ainda faltar algo, pergunta de novo e mantem na fila; se completou, cria
// de verdade e passa pro proximo item da fila, se houver.
async function resolvePendingCompletion(from: string, pending: PendingCompletion, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const cancel = /^(n[aã]o|n|cancela|deixa|espera|para|esquece)\b/.test(normalized);
  if (cancel) {
    clearHeadPendingCompletion(from);
    logActivity(from, "unknown", `${pending.intent} incompleto cancelado antes de completar`);
    await sendText(from, "Beleza, não criei nada.");
    await askNextPendingCompletionIfAny(from);
    return;
  }

  if (pending.intent === "expense") {
    const extracted = await extractExpenseInfoFromAnswer(answerText);
    if (!extracted) {
      await sendText(from, pendingCompletionQuestionText(from, pending, true));
      return;
    }
    const amount = extracted.amount ?? pending.amount;
    const description = extracted.description?.trim() || pending.description;
    if (amount === undefined || !description) {
      updatePendingCompletionHead(from, {
        intent: "expense",
        amount,
        description,
        category: pending.category,
        missing: missingExpenseParts(amount, description),
      });
      await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
      return;
    }
    clearHeadPendingCompletion(from);
    await createExpenseAndNotify(from, { amount, description, date: spDateString(), category: pending.category });
    await askNextPendingCompletionIfAny(from);
    return;
  }

  if (pending.intent === "installment_expense") {
    if (pending.missing.includes("category")) {
      // resposta EXPLICITA a "qual categoria e essa compra parcelada?" -- mesma
      // heuristica de resolvePendingCategorization (resposta curta = nome direto)
      const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
      const categoryName =
        findCategoryMentionedIn(from, answerText)?.name ?? (wordCount <= 3 ? answerText.trim() : await extractCategoryFromAnswer(answerText));
      clearHeadPendingCompletion(from);
      const created = await finalizeInstallmentExpense(
        from,
        {
          description: pending.description!,
          category: categoryName,
          payment_method: pending.payment_method,
          date: pending.date ?? spDateString(),
          totalAmount: pending.totalAmount,
          installmentAmount: pending.installmentAmount,
          installments: pending.installments!,
        },
        { forceCategory: true }
      );
      if (!created) {
        await sendText(from, "Deu erro tentando salvar a categoria. Tenta me responder de novo.");
        return;
      }
      await askNextPendingCompletionIfAny(from);
      return;
    }

    const extracted = await extractInstallmentInfoFromAnswer(answerText);
    if (!extracted) {
      await sendText(from, pendingCompletionQuestionText(from, pending, true));
      return;
    }
    const description = extracted.description?.trim() || pending.description;
    const installments = extracted.installments ?? pending.installments;
    // o valor pedido no follow-up e sempre o TOTAL (so perguntamos quando nem
    // total nem valor por parcela eram conhecidos ainda -- ver missingInstallmentParts)
    const totalAmount = extracted.amount ?? pending.totalAmount;
    const installmentAmount = pending.installmentAmount;
    const missing = missingInstallmentParts(totalAmount, installmentAmount, description, installments);
    if (missing.length > 0) {
      updatePendingCompletionHead(from, {
        intent: "installment_expense",
        description,
        category: pending.category,
        payment_method: pending.payment_method,
        date: pending.date,
        totalAmount,
        installmentAmount,
        installments,
        missing,
      });
      await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
      return;
    }

    clearHeadPendingCompletion(from);
    const created = await finalizeInstallmentExpense(from, {
      description: description!,
      category: pending.category,
      payment_method: pending.payment_method,
      date: pending.date ?? spDateString(),
      totalAmount,
      installmentAmount,
      installments: installments!,
    });
    if (!created) {
      const isHead = addPendingCompletion(from, {
        intent: "installment_expense",
        description,
        category: pending.category,
        payment_method: pending.payment_method,
        date: pending.date,
        totalAmount,
        installmentAmount,
        installments,
        missing: ["category"],
      });
      if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
      return;
    }
    await askNextPendingCompletionIfAny(from);
    return;
  }

  // event / reminder
  const extracted = await extractDateTimeFromAnswer(answerText);
  if (!extracted) {
    await sendText(from, pendingCompletionQuestionText(from, pending, true));
    return;
  }
  const date = extracted.newDate ?? pending.date;
  const time = extracted.newTime ?? pending.time;
  if (!date || !time) {
    if (pending.intent === "event") {
      updatePendingCompletionHead(from, { intent: "event", title: pending.title, date, time, missing: missingDateTimeParts(date, time) });
    } else {
      updatePendingCompletionHead(from, {
        intent: "reminder",
        message: pending.message,
        date,
        time,
        missing: missingDateTimeParts(date, time),
      });
    }
    await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
    return;
  }

  clearHeadPendingCompletion(from);
  const startAt = `${date}T${time}:00`;
  if (pending.intent === "event") {
    await createEventAndNotify(from, { title: pending.title!, start: startAt });
  } else {
    await createReminderAndNotify(from, { message: pending.message!, due_at: startAt });
  }
  await askNextPendingCompletionIfAny(from);
}

// Se a IA classificou como "unknown" mas com likely_intent e ao menos uma
// informacao parcial ja reconhecida (titulo, dia, horario, valor ou
// descricao), entra na fila de completude e pergunta so o que falta, em vez
// da mensagem generica de "nao entendi". Retorna false se nao tinha
// informacao parcial suficiente pra isso (aí o chamador usa a mensagem
// generica de sempre).
async function maybeStartPendingCompletion(from: string, interpretation: Extract<Interpretation, { type: "unknown" }>): Promise<boolean> {
  if (interpretation.likely_intent === "event" && interpretation.title) {
    const missing = missingDateTimeParts(interpretation.date, interpretation.time);
    if (missing.length === 0) {
      await createEventAndNotify(from, { title: interpretation.title, start: `${interpretation.date}T${interpretation.time}:00` });
      return true;
    }
    const isHead = addPendingCompletion(from, {
      intent: "event",
      title: interpretation.title,
      date: interpretation.date,
      time: interpretation.time,
      missing,
    });
    logActivity(from, "unknown", `evento parcial "${interpretation.title}" -- pedindo o que falta`);
    if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
    return true;
  }
  if (interpretation.likely_intent === "reminder" && interpretation.message) {
    const missing = missingDateTimeParts(interpretation.date, interpretation.time);
    if (missing.length === 0) {
      await createReminderAndNotify(from, { message: interpretation.message, due_at: `${interpretation.date}T${interpretation.time}:00` });
      return true;
    }
    const isHead = addPendingCompletion(from, {
      intent: "reminder",
      message: interpretation.message,
      date: interpretation.date,
      time: interpretation.time,
      missing,
    });
    logActivity(from, "unknown", `lembrete parcial "${interpretation.message}" -- pedindo o que falta`);
    if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
    return true;
  }
  if (interpretation.likely_intent === "expense" && (interpretation.amount !== undefined || interpretation.description)) {
    const missing = missingExpenseParts(interpretation.amount, interpretation.description);
    if (missing.length === 0) {
      await createExpenseAndNotify(from, {
        amount: interpretation.amount!,
        description: interpretation.description!,
        date: spDateString(),
        category: interpretation.category,
      });
      return true;
    }
    const isHead = addPendingCompletion(from, {
      intent: "expense",
      amount: interpretation.amount,
      description: interpretation.description,
      category: interpretation.category,
      missing,
    });
    logActivity(from, "unknown", "gasto parcial -- pedindo o que falta");
    if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
    return true;
  }
  return false;
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
    await sendText(
      from,
      `✅ Categorizado como "${category.name}". Gasto de R$${pending.amount.toFixed(2)} — ${pending.description}${paymentSuffix} registrado.${budgetAlert}`
    );

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

// resposta a "confirma que quer mudar N gastos pra categoria X?" -- so aplica de
// verdade com um "sim" claro; resposta ambigua pergunta de novo em vez de assumir
async function resolveBulkRecategorizeConfirmation(from: string, pending: PendingBulkRecategorize, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer mudar ${pending.summary} pra "${pending.toCategoryName}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingBulkRecategorize(from);
  if (no) {
    logActivity(from, "bulk_recategorize", `${pending.summary} -> "${pending.toCategoryName}" nao confirmado`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  bulkUpdateExpenseCategory(from, pending.expenseIds, pending.toCategoryId);
  setPendingUndo(from, {
    kind: "bulk_restore_category",
    changes: pending.previous,
    description: `${pending.summary} -> ${pending.toCategoryName}`,
  });
  logActivity(from, "bulk_recategorize", `confirmado: ${pending.summary} -> "${pending.toCategoryName}"`);
  await sendText(from, `✅ Prontinho, ${pending.expenseIds.length} gasto(s) agora ${pending.expenseIds.length === 1 ? "está" : "estão"} em "${pending.toCategoryName}".`);
}

// resposta a "confirma que quer juntar a categoria X na Y?" -- so apaga a
// categoria de origem de verdade com um "sim" claro
async function resolveMergeCategoriesConfirmation(from: string, pending: PendingMergeCategories, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(
      from,
      `Não entendi — confirma que quer juntar "${pending.sourceCategoryName}" em "${pending.targetCategoryName}"? Responde "sim" ou "não".`
    );
    return;
  }

  clearPendingMergeCategories(from);
  if (no) {
    logActivity(from, "merge_categories", `"${pending.sourceCategoryName}" -> "${pending.targetCategoryName}" nao confirmado`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  bulkUpdateExpenseCategory(from, pending.expenseIds, pending.targetCategoryId);
  deleteCategory(from, pending.sourceCategoryId);
  setPendingUndo(from, {
    kind: "undo_merge_categories",
    expenseIds: pending.expenseIds,
    sourceCategoryName: pending.sourceCategoryName,
    description: `"${pending.sourceCategoryName}" -> "${pending.targetCategoryName}"`,
  });
  logActivity(from, "merge_categories", `confirmado: "${pending.sourceCategoryName}" juntada em "${pending.targetCategoryName}"`);
  await sendText(
    from,
    `✅ Categoria "${pending.sourceCategoryName}" juntada em "${pending.targetCategoryName}". ${pending.expenseIds.length} gasto(s) movido(s), e "${pending.sourceCategoryName}" não existe mais.`
  );
}

// calcula o novo valor de um campo de gasto (usado tanto no pedido inicial de
// edicao quanto quando o usuario ajusta o valor proposto antes de confirmar)
function parseEditFieldValue(
  from: string,
  field: "amount" | "date" | "description" | "payment_method",
  rawValue: string,
  baseParams: EditExpenseParams
): { params: EditExpenseParams; changeText: string } | { error: string } {
  const params = { ...baseParams };
  if (field === "amount") {
    const amount = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return { error: `Não entendi o valor "${rawValue}".` };
    params.amount = amount;
    return { params, changeText: `valor agora é R$${amount.toFixed(2)}` };
  }
  if (field === "date") {
    params.date = rawValue;
    return { params, changeText: `data agora é ${formatDateOnly(rawValue)}` };
  }
  if (field === "description") {
    params.description = rawValue;
    return { params, changeText: `descrição agora é "${rawValue}"` };
  }
  const paymentMethod = getOrCreatePaymentMethod(from, rawValue);
  params.paymentMethodId = paymentMethod.id;
  return { params, changeText: `forma de pagamento agora é "${paymentMethod.name}"` };
}

// resposta a "vou mudar X, confirma?" -- "sim" aplica, "nao" cancela, qualquer
// outra coisa e tratada como um AJUSTE (novo valor pro mesmo campo) e volta a
// pedir confirmacao com o valor corrigido, em vez de assumir ou travar
async function resolveEditExpenseConfirmation(from: string, pending: PendingEditExpense, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (yes) {
    clearPendingEditExpense(from);
    updateExpense(from, pending.expenseId, pending.proposedParams);
    setPendingUndo(from, {
      kind: "restore_expense",
      expenseId: pending.expenseId,
      previous: pending.previous,
      description: pending.description,
    });
    logActivity(from, "edit_expense", `confirmado: #${pending.expenseId} ${pending.description}: ${pending.changeText}`);
    await sendText(from, `✏️ Gasto "${pending.description}" atualizado: ${pending.changeText}`);
    return;
  }
  if (no) {
    clearPendingEditExpense(from);
    logActivity(from, "edit_expense", `edicao de #${pending.expenseId} nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  const result = parseEditFieldValue(from, pending.field, answerText.trim(), pending.previous);
  if ("error" in result) {
    await sendText(from, `Não entendi — confirma "${pending.changeText}"? Responde "sim"/"não", ou me diga o valor certo.`);
    return;
  }
  setPendingEditExpense(from, { ...pending, proposedParams: result.params, changeText: result.changeText });
  await sendText(from, `Ok, vou alterar "${pending.description}": ${result.changeText}. Confirma? Responde "sim" ou "não".`);
}

// mesma ideia da confirmacao de edicao, mas pra correct_category: "nao" ou
// texto ambiguo tenta reinterpretar como uma categoria diferente, igual
// resolvePendingCategorization ja faz pra gasto pendente de categoria
async function resolveCorrectCategoryConfirmation(from: string, pending: PendingCorrectCategory, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (yes) {
    clearPendingCorrectCategory(from);
    updateExpenseCategory(pending.expenseId, pending.proposedCategoryId);
    learnKeyword(from, pending.description, pending.proposedCategoryId);
    if (pending.previousCategoryId != null) {
      setPendingUndo(from, {
        kind: "restore_category",
        expenseId: pending.expenseId,
        previousCategoryId: pending.previousCategoryId,
        description: pending.description,
      });
    }
    logActivity(from, "correct_category", `confirmado: ${pending.description} agora e "${pending.proposedCategoryName}"`);
    await sendText(from, `✏️ Categoria de "${pending.description}" (R$${pending.amount.toFixed(2)}) corrigida para "${pending.proposedCategoryName}"`);
    return;
  }
  if (no) {
    clearPendingCorrectCategory(from);
    logActivity(from, "correct_category", `correcao de ${pending.description} nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
  const categoryName =
    findCategoryMentionedIn(from, answerText)?.name ?? (wordCount <= 3 ? answerText.trim() : await extractCategoryFromAnswer(answerText));
  const newCategory = getOrCreateCategory(from, categoryName);
  setPendingCorrectCategory(from, { ...pending, proposedCategoryId: newCategory.id, proposedCategoryName: newCategory.name });
  await sendText(from, `Ok, vou mudar a categoria de "${pending.description}" pra "${newCategory.name}" então. Confirma? Responde "sim" ou "não".`);
}

// resposta a "vou remarcar o evento X pra data/hora Y, confirma?" -- ajuste (nem
// sim nem nao) tenta reinterpretar a resposta como uma NOVA data/hora via IA
// (extractDateTimeFromAnswer), pra funcionar mesmo com frase livre tipo "na
// verdade e sexta as 16h", nao so um ISO exato
async function resolveEditEventConfirmation(from: string, pending: PendingEditEvent, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (yes) {
    clearPendingEditEvent(from);
    updateEvent(from, pending.eventId, {
      title: pending.previous.title,
      start: pending.proposedStart,
      end: pending.proposedEnd,
      location: pending.previous.location ?? undefined,
      reminderMinutes: pending.previous.reminderMinutes,
    });
    setPendingUndo(from, {
      kind: "restore_event_time",
      eventId: pending.eventId,
      previous: pending.previous,
      description: pending.title,
    });
    logActivity(from, "edit_event", `confirmado: "${pending.title}": ${pending.changeText}`);
    await sendText(from, `✏️ Evento "${pending.title}" remarcado: ${pending.changeText}`);
    return;
  }
  if (no) {
    clearPendingEditEvent(from);
    logActivity(from, "edit_event", `remarcacao de "${pending.title}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  const extracted = await extractDateTimeFromAnswer(answerText);
  if (!extracted) {
    await sendText(from, `Não entendi — confirma "${pending.changeText}"? Responde "sim"/"não", ou me diga a data/hora certa.`);
    return;
  }
  // mescla com o valor JA PROPOSTO (nao o original do evento) -- se o ajuste so
  // mencionar o dia, mantem a hora que ja tinha sido proposta antes, nao a antiga
  const newStart = mergeDateTime(pending.proposedStart, extracted.newDate, extracted.newTime);
  const durationMs = new Date(pending.previous.end).getTime() - new Date(pending.previous.start).getTime();
  const newEnd = new Date(new Date(newStart).getTime() + durationMs).toISOString();
  const changeText = `de ${formatDateTime(pending.previous.start)} pra ${formatDateTime(newStart)}`;
  setPendingEditEvent(from, { ...pending, proposedStart: newStart, proposedEnd: newEnd, changeText });
  await sendText(from, `Ok, vou remarcar "${pending.title}": ${changeText}. Confirma? Responde "sim" ou "não".`);
}

// mesma ideia de resolveEditEventConfirmation, pra lembrete
async function resolveEditReminderConfirmation(from: string, pending: PendingEditReminder, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (yes) {
    clearPendingEditReminder(from);
    updateReminder(from, pending.reminderId, { message: pending.message, dueAt: pending.proposedDueAt });
    setPendingUndo(from, {
      kind: "restore_reminder_time",
      reminderId: pending.reminderId,
      previousDueAt: pending.previousDueAt,
      description: pending.message,
    });
    logActivity(from, "edit_reminder", `confirmado: "${pending.message}": ${pending.changeText}`);
    await sendText(from, `✏️ Lembrete "${pending.message}" remarcado: ${pending.changeText}`);
    return;
  }
  if (no) {
    clearPendingEditReminder(from);
    logActivity(from, "edit_reminder", `remarcacao de "${pending.message}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  const extracted = await extractDateTimeFromAnswer(answerText);
  if (!extracted) {
    await sendText(from, `Não entendi — confirma "${pending.changeText}"? Responde "sim"/"não", ou me diga a data/hora certa.`);
    return;
  }
  const newDueAt = mergeDateTime(pending.proposedDueAt, extracted.newDate, extracted.newTime);
  const changeText = `de ${formatDateTime(pending.previousDueAt)} pra ${formatDateTime(newDueAt)}`;
  setPendingEditReminder(from, { ...pending, proposedDueAt: newDueAt, changeText });
  await sendText(from, `Ok, vou remarcar o lembrete "${pending.message}": ${changeText}. Confirma? Responde "sim" ou "não".`);
}

// resposta a "confirma que quer remover o orcamento de X?" -- so remove de
// verdade com um "sim" claro, igual as outras confirmacoes de exclusao
async function resolveRemoveBudgetConfirmation(from: string, pending: PendingRemoveBudget, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer remover o orçamento de "${pending.categoryName}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingRemoveBudget(from);
  if (no) {
    logActivity(from, "remove_budget", `remocao do orcamento de ${pending.categoryName} nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  removeBudget(from, pending.categoryId);
  setPendingUndo(from, {
    kind: "restore_budget",
    categoryId: pending.categoryId,
    monthlyLimit: pending.monthlyLimit,
    description: pending.categoryName,
  });
  logActivity(from, "remove_budget", `confirmado: orcamento de ${pending.categoryName} removido`);
  await sendText(from, `✅ Orçamento de "${pending.categoryName}" removido.`);
}

// mesma ideia de resolveRemoveBudgetConfirmation, pra gasto fixo
async function resolveRemoveRecurringConfirmation(from: string, pending: PendingRemoveRecurring, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer parar de lançar o gasto fixo "${pending.description}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingRemoveRecurring(from);
  if (no) {
    logActivity(from, "remove_recurring_expense", `remocao de "${pending.description}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  deactivateRecurringExpense(from, pending.recurringId);
  setPendingUndo(from, {
    kind: "restore_recurring_expense",
    params: {
      fromNumber: from,
      description: pending.description,
      amount: pending.amount,
      categoryId: pending.categoryId,
      paymentMethodId: pending.paymentMethodId,
      dayOfMonth: pending.dayOfMonth,
    },
    description: pending.description,
  });
  logActivity(from, "remove_recurring_expense", `confirmado: "${pending.description}" removido`);
  await sendText(from, `✅ Gasto fixo "${pending.description}" removido. Não vou mais lançar ele automaticamente.`);
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
      await createExpenseAndNotify(from, {
        amount: interpretation.amount,
        description,
        date: interpretation.date || spDateString(),
        category: interpretation.category,
        payment_method: interpretation.payment_method,
      });
      break;
    }
    case "installment_expense": {
      const missing = missingInstallmentParts(
        interpretation.total_amount,
        interpretation.installment_amount,
        interpretation.description,
        interpretation.installments
      );
      const baseParams = {
        description: interpretation.description,
        category: interpretation.category,
        payment_method: interpretation.payment_method,
        date: interpretation.date || spDateString(),
        totalAmount: interpretation.total_amount,
        installmentAmount: interpretation.installment_amount,
      };
      if (missing.length === 0) {
        const created = await finalizeInstallmentExpense(from, {
          ...baseParams,
          description: interpretation.description!,
          installments: interpretation.installments!,
        });
        if (!created) {
          const isHead = addPendingCompletion(from, {
            intent: "installment_expense",
            ...baseParams,
            installments: interpretation.installments,
            missing: ["category"],
          });
          if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
        }
        break;
      }
      const isHead = addPendingCompletion(from, { intent: "installment_expense", ...baseParams, installments: interpretation.installments, missing });
      logActivity(from, "installment_expense", "compra parcelada incompleta -- pedindo o que falta");
      if (isHead) await sendText(from, pendingCompletionQuestionText(from, getNextPendingCompletion(from)!));
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
      const previousCategory = expense.category_id ? getCategoryById(from, expense.category_id) : null;
      if (previousCategory?.id === category.id) {
        await sendText(from, `"${expense.description}" já está em "${category.name}".`);
        break;
      }

      setPendingCorrectCategory(from, {
        expenseId: expense.id,
        description: expense.description,
        amount: expense.amount,
        previousCategoryId: expense.category_id,
        previousCategoryName: previousCategory?.name ?? "sem categoria",
        proposedCategoryId: category.id,
        proposedCategoryName: category.name,
      });
      logActivity(
        from,
        "correct_category",
        `pediu confirmacao: ${expense.description} de "${previousCategory?.name ?? "sem categoria"}" pra "${category.name}"`
      );
      await sendText(
        from,
        `Vou mudar a categoria de "${expense.description}" (R$${expense.amount.toFixed(2)}) de "${previousCategory?.name ?? "sem categoria"}" pra "${category.name}". Confirma? Responde "sim"/"não", ou diga a categoria certa.`
      );
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
      await createEventAndNotify(from, {
        title: interpretation.title,
        start: interpretation.start,
        end: interpretation.end,
        location: interpretation.location,
      });
      break;
    }
    case "delete_event": {
      const matches = findUpcomingEvents(from, interpretation.query);
      if (matches.length === 0) {
        logActivity(from, "delete_event", `nenhum evento encontrado para "${interpretation.query}"`);
        await sendText(from, `Não encontrei nenhum evento futuro parecido com "${interpretation.query}".`);
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
    case "edit_event": {
      const matches = findUpcomingEvents(from, interpretation.query);
      if (matches.length === 0) {
        logActivity(from, "edit_event", `nenhum evento encontrado para "${interpretation.query}"`);
        await sendText(from, `Não encontrei nenhum evento futuro parecido com "${interpretation.query}".`);
        break;
      }
      if (matches.length > 1) {
        const list = matches.map((e) => `• ${e.title} — ${formatDateTime(e.start)}`).join("\n");
        logActivity(from, "edit_event", `${matches.length} eventos parecidos com "${interpretation.query}", pedi pra especificar`);
        await sendText(from, `Achei mais de um evento parecido com "${interpretation.query}":\n${list}\n\nMe diga o nome mais específico de qual quer remarcar.`);
        break;
      }
      if (!interpretation.new_date && !interpretation.new_time) {
        await sendText(from, "Não entendi pra quando remarcar. Me diga o novo dia e/ou horário.");
        break;
      }

      const event = matches[0];
      // preenche so o que foi pedido -- "muda so o dia" mantem o horario
      // original, "muda so o horario" mantem a data original (ver mergeDateTime)
      const newStart = mergeDateTime(event.start, interpretation.new_date, interpretation.new_time);
      const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newEnd = new Date(new Date(newStart).getTime() + durationMs).toISOString();
      const changeText = `de ${formatDateTime(event.start)} pra ${formatDateTime(newStart)}`;

      setPendingEditEvent(from, {
        eventId: event.id,
        title: event.title,
        previous: {
          title: event.title,
          start: event.start,
          end: event.end,
          location: event.location,
          reminderMinutes: event.reminder_minutes,
        },
        proposedStart: newStart,
        proposedEnd: newEnd,
        changeText,
      });
      logActivity(from, "edit_event", `pediu confirmacao: "${event.title}" ${changeText}`);
      await sendText(
        from,
        `Vou remarcar "${event.title}": ${changeText}. Confirma? Responde "sim"/"não", ou me diga a data/hora certa se eu errei.`
      );
      break;
    }
    case "reminder": {
      await createReminderAndNotify(from, { message: interpretation.message, due_at: interpretation.due_at });
      break;
    }
    case "edit_reminder": {
      const matches = findPendingRemindersByText(from, interpretation.query);
      if (matches.length === 0) {
        logActivity(from, "edit_reminder", `nenhum lembrete encontrado para "${interpretation.query}"`);
        await sendText(from, `Não encontrei nenhum lembrete parecido com "${interpretation.query}".`);
        break;
      }
      if (matches.length > 1) {
        const list = matches.map((r) => `• ${r.message} — ${formatDateTime(r.due_at)}`).join("\n");
        logActivity(from, "edit_reminder", `${matches.length} lembretes parecidos com "${interpretation.query}", pedi pra especificar`);
        await sendText(from, `Achei mais de um lembrete parecido com "${interpretation.query}":\n${list}\n\nMe diga o texto mais específico de qual quer remarcar.`);
        break;
      }

      if (!interpretation.new_date && !interpretation.new_time) {
        await sendText(from, "Não entendi pra quando remarcar. Me diga o novo dia e/ou horário.");
        break;
      }

      const reminder = matches[0];
      const newDueAt = mergeDateTime(reminder.due_at, interpretation.new_date, interpretation.new_time);
      const changeText = `de ${formatDateTime(reminder.due_at)} pra ${formatDateTime(newDueAt)}`;

      setPendingEditReminder(from, {
        reminderId: reminder.id,
        message: reminder.message,
        previousDueAt: reminder.due_at,
        proposedDueAt: newDueAt,
        changeText,
      });
      logActivity(from, "edit_reminder", `pediu confirmacao: "${reminder.message}" ${changeText}`);
      await sendText(
        from,
        `Vou remarcar o lembrete "${reminder.message}": ${changeText}. Confirma? Responde "sim"/"não", ou me diga a data/hora certa se eu errei.`
      );
      break;
    }
    case "report": {
      const events = interpretation.month ? getEventsForMonth(from, interpretation.month) : listUpcomingEvents(from, interpretation.days ?? 7);
      const reminders = interpretation.month
        ? getRemindersForMonth(from, interpretation.month)
        : getRemindersWithinDays(from, interpretation.days ?? 7);

      const eventsText = events.length
        ? events.map((e) => `• ${e.title} — ${formatDateTime(e.start)}`).join("\n")
        : "Nenhum evento agendado.";
      const remindersText = reminders.length
        ? reminders.map((r) => `• ${r.message} — ${formatDateTime(r.due_at)}`).join("\n")
        : "Nenhum lembrete agendado.";

      const label = interpretation.month ? monthLabelPt(interpretation.month) : `próximos ${interpretation.days ?? 7} dias`;
      logActivity(from, "report", `${label}: ${events.length} eventos, ${reminders.length} lembretes`);
      await sendText(from, `📊 Agenda — ${label}\n\n📅 Eventos:\n${eventsText}\n\n⏰ Lembretes:\n${remindersText}`);
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
      const limit = category ? getBudget(from, category.id) : null;
      if (!category || limit == null) {
        logActivity(from, "remove_budget", `nenhum orcamento encontrado para "${interpretation.category}"`);
        await sendText(from, `Não achei orçamento definido pra "${interpretation.category}".`);
        break;
      }
      setPendingRemoveBudget(from, { categoryId: category.id, categoryName: category.name, monthlyLimit: limit });
      logActivity(from, "remove_budget", `pediu confirmacao pra remover orcamento de ${category.name}`);
      await sendText(
        from,
        `Vou remover o orçamento de "${category.name}" (R$${limit.toFixed(2)}/mês). Confirma? Responde "sim" ou "não".`
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
    case "create_category": {
      const alreadyExisted = findCategoryByName(from, interpretation.category) !== null;
      const category = getOrCreateCategory(from, interpretation.category);
      logActivity(from, "create_category", alreadyExisted ? `"${category.name}" ja existia` : `"${category.name}" criada`);
      await sendText(
        from,
        alreadyExisted
          ? `Você já tem uma categoria chamada "${category.name}".`
          : `✅ Categoria "${category.name}" criada. Já pode usar ela nos seus gastos, tipo "50 no mercado categoria ${category.name}".`
      );
      break;
    }
    case "merge_categories": {
      const sourceCategory = findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category);
      if (!sourceCategory) {
        logActivity(from, "merge_categories", `categoria de origem "${interpretation.category}" nao encontrada`);
        await sendText(from, `Não achei uma categoria parecida com "${interpretation.category}".`);
        break;
      }
      const targetCategory = getOrCreateCategory(from, interpretation.to_category);
      if (sourceCategory.id === targetCategory.id) {
        await sendText(from, "Essas duas já são a mesma categoria.");
        break;
      }

      const items = getExpensesByCategoryId(from, sourceCategory.id);
      setPendingMergeCategories(from, {
        sourceCategoryId: sourceCategory.id,
        sourceCategoryName: sourceCategory.name,
        targetCategoryId: targetCategory.id,
        targetCategoryName: targetCategory.name,
        expenseIds: items.map((i) => i.id),
      });
      logActivity(from, "merge_categories", `pediu confirmacao: "${sourceCategory.name}" -> "${targetCategory.name}" (${items.length} gasto(s))`);
      await sendText(
        from,
        `Encontrei ${items.length} gasto(s) em "${sourceCategory.name}". Confirma que quer juntar essa categoria em "${targetCategory.name}"? "${sourceCategory.name}" vai deixar de existir. Responde "sim" ou "não".`
      );
      break;
    }
    case "bulk_recategorize": {
      const toCategory = getOrCreateCategory(from, interpretation.to_category);

      let items: ExpenseListItem[];
      let summary: string;
      if (interpretation.scope === "today") {
        const range = singleDayRange(spDateString(), "hoje");
        items = getExpensesBetween(from, range.start, range.end);
        summary = "os gastos de hoje";
      } else if (interpretation.scope === "last_n") {
        const n = interpretation.n ?? 5;
        items = getRecentExpensesList(from, n);
        summary = `os últimos ${items.length} gasto(s)`;
      } else if (interpretation.scope === "from_category") {
        const fromCategory = interpretation.category
          ? (findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category))
          : null;
        if (!fromCategory) {
          logActivity(from, "bulk_recategorize", `categoria de origem "${interpretation.category ?? ""}" nao encontrada`);
          await sendText(from, `Não achei uma categoria parecida com "${interpretation.category ?? ""}".`);
          break;
        }
        items = getExpensesByCategoryId(from, fromCategory.id);
        summary = `os gastos de "${fromCategory.name}"`;
      } else if (interpretation.scope === "period") {
        const range =
          interpretation.date_start && interpretation.date_end
            ? {
                start: interpretation.date_start.slice(0, 10),
                end: addOneDayToDateString(interpretation.date_end),
                label: `${formatDateOnly(interpretation.date_start)} a ${formatDateOnly(interpretation.date_end)}`,
              }
            : interpretation.days
              ? lastNDaysRange(interpretation.days)
              : interpretation.period === "week"
                ? currentWeekRange()
                : currentMonthRange();
        items = getExpensesBetween(from, range.start, range.end);
        summary = `os gastos de ${range.label}`;
      } else {
        const query = interpretation.query?.trim() ?? "";
        if (!query) {
          await sendText(from, "Não entendi qual palavra usar pra encontrar os gastos. Pode dizer de novo com um exemplo, tipo \"muda os gastos com ifood pra alimentação\"?");
          break;
        }
        items = searchExpenses(from, query);
        summary = `os gastos com "${query}" na descrição`;
      }

      if (!items.length) {
        logActivity(from, "bulk_recategorize", `nenhum gasto encontrado (${summary})`);
        await sendText(from, "Não encontrei nenhum gasto nessas condições.");
        break;
      }

      const previous = items.map((i) => {
        const full = getExpenseById(from, i.id)!;
        return { expenseId: i.id, previousCategoryId: full.category_id };
      });
      setPendingBulkRecategorize(from, {
        expenseIds: items.map((i) => i.id),
        previous,
        toCategoryId: toCategory.id,
        toCategoryName: toCategory.name,
        summary,
      });

      const preview = items
        .slice(0, 5)
        .map((i) => `• R$${i.amount.toFixed(2)} — ${i.description}`)
        .join("\n");
      const extra = items.length > 5 ? `\n… e mais ${items.length - 5}` : "";
      logActivity(from, "bulk_recategorize", `pediu confirmacao: ${summary} -> "${toCategory.name}" (${items.length} gasto(s))`);
      await sendText(
        from,
        `Encontrei ${items.length} gasto(s) (${summary}):\n${preview}${extra}\n\nConfirma que quer mudar ${items.length === 1 ? "ele" : "todos"} pra categoria "${toCategory.name}"? Responde "sim" ou "não".`
      );
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

      const baseParams: EditExpenseParams = {
        amount: expense.amount,
        description: expense.description,
        date: expense.date,
        categoryId: expense.category_id,
        paymentMethodId: expense.payment_method_id,
      };
      const result = parseEditFieldValue(from, interpretation.field, interpretation.value, baseParams);
      if ("error" in result) {
        logActivity(from, "edit_expense", result.error);
        await sendText(from, result.error);
        break;
      }

      setPendingEditExpense(from, {
        expenseId: expense.id,
        field: interpretation.field,
        description: expense.description,
        previous: baseParams,
        proposedParams: result.params,
        changeText: result.changeText,
      });
      logActivity(from, "edit_expense", `pediu confirmacao: #${expense.id} ${expense.description}: ${result.changeText}`);
      await sendText(
        from,
        `Vou alterar "${expense.description}": ${result.changeText}. Confirma? Responde "sim"/"não", ou me diga o valor certo se eu errei.`
      );
      break;
    }
    case "set_recurring_expense": {
      if (interpretation.day_of_month < 1 || interpretation.day_of_month > 31) {
        await sendText(from, `O dia do mês precisa ser entre 1 e 31. "${interpretation.day_of_month}" não é um dia válido.`);
        break;
      }
      const category = getOrCreateCategory(from, interpretation.category);
      const paymentMethod = resolvePaymentMethod(from, interpretation.payment_method);
      createRecurringExpense({
        fromNumber: from,
        description: interpretation.description,
        amount: interpretation.amount,
        categoryId: category.id,
        paymentMethodId: paymentMethod?.id ?? null,
        dayOfMonth: interpretation.day_of_month,
      });
      logActivity(
        from,
        "set_recurring_expense",
        `R$${interpretation.amount.toFixed(2)} em ${category.name} — ${interpretation.description}, todo dia ${interpretation.day_of_month}`
      );
      await sendText(
        from,
        `🔁 Gasto fixo cadastrado: R$${interpretation.amount.toFixed(2)} em ${category.name} — ${interpretation.description}, todo dia ${interpretation.day_of_month}. Vou lançar esse valor automaticamente todo mês, sem você precisar mandar mensagem.`
      );
      break;
    }
    case "list_recurring_expenses": {
      const recurring = listRecurringExpenses(from);
      logActivity(from, "list_recurring_expenses", `${recurring.length} gasto(s) fixo(s)`);
      if (!recurring.length) {
        await sendText(
          from,
          "Você ainda não tem nenhum gasto fixo cadastrado. Pode dizer algo como \"todo dia 10 pago 50 reais de internet\"."
        );
        break;
      }
      const lines = recurring.map((r) => `• ${r.description} — R$${r.amount.toFixed(2)}, todo dia ${r.day_of_month}`).join("\n");
      await sendText(from, `🔁 Seus gastos fixos:\n\n${lines}\n\nPra parar de lançar um, é só dizer, ex: "cancela o gasto fixo da internet".`);
      break;
    }
    case "remove_recurring_expense": {
      const recurring = findActiveRecurringExpenseByDescription(from, interpretation.query);
      if (!recurring) {
        logActivity(from, "remove_recurring_expense", `nenhum gasto fixo encontrado para "${interpretation.query}"`);
        await sendText(from, `Não achei nenhum gasto fixo parecido com "${interpretation.query}".`);
        break;
      }
      setPendingRemoveRecurring(from, {
        recurringId: recurring.id,
        description: recurring.description,
        amount: recurring.amount,
        dayOfMonth: recurring.day_of_month,
        categoryId: recurring.category_id,
        paymentMethodId: recurring.payment_method_id,
      });
      logActivity(from, "remove_recurring_expense", `pediu confirmacao pra remover "${recurring.description}"`);
      await sendText(
        from,
        `Vou parar de lançar o gasto fixo "${recurring.description}" (R$${recurring.amount.toFixed(2)}, todo dia ${recurring.day_of_month}). Confirma? Responde "sim" ou "não".`
      );
      break;
    }
    case "income": {
      const date = interpretation.date || spDateString();
      const created = insertIncome({ fromNumber: from, amount: interpretation.amount, description: interpretation.description, date });
      setPendingUndo(from, {
        kind: "delete_income",
        incomeId: created.id,
        description: `R$${interpretation.amount.toFixed(2)} — ${interpretation.description}`,
      });
      logActivity(from, "income", `R$${interpretation.amount.toFixed(2)} — ${interpretation.description}`);
      await sendText(from, `💵 Entrada registrada: R$${interpretation.amount.toFixed(2)} — ${interpretation.description}`);
      break;
    }
    case "income_report": {
      const range = interpretation.days
        ? lastNDaysRange(interpretation.days)
        : interpretation.period === "week"
          ? currentWeekRange()
          : currentMonthRange();
      const summary = getIncomeSummaryBetween(range.start, range.end, from);
      logActivity(from, "income_report", `${range.label}: R$${summary.total.toFixed(2)} em ${summary.count} entrada(s)`);
      if (!summary.count) {
        await sendText(from, `💵 Entradas — ${range.label}\n\nNenhuma entrada registrada nesse período.`);
        break;
      }
      await sendText(from, `💵 Entradas — ${range.label}\n\nTotal: R$${summary.total.toFixed(2)} em ${summary.count} entrada(s)`);
      break;
    }
    case "balance": {
      const range = interpretation.days
        ? lastNDaysRange(interpretation.days)
        : interpretation.period === "week"
          ? currentWeekRange()
          : currentMonthRange();
      const income = getIncomeSummaryBetween(range.start, range.end, from);
      const expense = getExpenseSummaryBetween(range.start, range.end, from);
      const balance = income.total - expense.total;
      const balanceEmoji = balance >= 0 ? "✅" : "🔻";
      logActivity(from, "balance", `${range.label}: entradas R$${income.total.toFixed(2)}, gastos R$${expense.total.toFixed(2)}, saldo R$${balance.toFixed(2)}`);
      await sendText(
        from,
        `📊 Saldo — ${range.label}\n\n💵 Entradas: R$${income.total.toFixed(2)}\n💰 Gastos: R$${expense.total.toFixed(2)}\n${balanceEmoji} Saldo: R$${balance.toFixed(2)}`
      );
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
        case "delete_expenses_bulk":
          for (const expenseId of undo.expenseIds) deleteExpense(from, expenseId);
          logActivity(from, "undo", `compra parcelada removida: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: ${undo.description} removido(a) (${undo.expenseIds.length} parcela(s)).`);
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
        case "delete_income":
          deleteIncome(from, undo.incomeId);
          logActivity(from, "undo", `entrada removida: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: entrada de ${undo.description} removida.`);
          break;
        case "bulk_restore_category":
          for (const change of undo.changes) updateExpenseCategory(change.expenseId, change.previousCategoryId);
          logActivity(from, "undo", `recategorizacao em lote desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz a mudança de categoria de ${undo.changes.length} gasto(s).`);
          break;
        case "undo_merge_categories": {
          // a categoria de origem foi apagada no merge -- recria pelo nome (fica
          // com um id novo, mas mesma funcao pro usuario) e move os gastos de volta
          const recreated = getOrCreateCategory(from, undo.sourceCategoryName);
          for (const expenseId of undo.expenseIds) updateExpenseCategory(expenseId, recreated.id);
          logActivity(from, "undo", `merge de categorias desfeito: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, recriei "${undo.sourceCategoryName}" e devolvi ${undo.expenseIds.length} gasto(s) pra ela.`);
          break;
        }
        case "restore_event_time":
          updateEvent(from, undo.eventId, {
            title: undo.previous.title,
            start: undo.previous.start,
            end: undo.previous.end,
            location: undo.previous.location ?? undefined,
            reminderMinutes: undo.previous.reminderMinutes,
          });
          logActivity(from, "undo", `remarcacao de evento desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, "${undo.description}" voltou pro horário de antes.`);
          break;
        case "restore_reminder_time":
          updateReminder(from, undo.reminderId, { message: undo.description, dueAt: undo.previousDueAt });
          logActivity(from, "undo", `remarcacao de lembrete desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o lembrete "${undo.description}" voltou pro horário de antes.`);
          break;
        case "restore_budget":
          setBudget(from, undo.categoryId, undo.monthlyLimit);
          logActivity(from, "undo", `orcamento restaurado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o orçamento de "${undo.description}" voltou (R$${undo.monthlyLimit.toFixed(2)}/mês).`);
          break;
        case "restore_recurring_expense":
          createRecurringExpense(undo.params);
          logActivity(from, "undo", `gasto fixo recriado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o gasto fixo "${undo.description}" voltou a ser lançado automaticamente.`);
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

🔁 *Gastos fixos*
"Todo dia 10 pago 50 reais de internet" — eu cadastro e lanço esse valor sozinho todo mês, sem você precisar mandar mensagem de novo.

💵 *Entradas e saldo*
"Recebi 3000 de salário" registra a entrada. "Qual meu saldo esse mês" mostra quanto sobrou (entradas menos gastos).

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
      const started = await maybeStartPendingCompletion(from, interpretation);
      if (!started) await sendText(from, unknownFollowUp(interpretation.likely_intent));
    }
  }
}
