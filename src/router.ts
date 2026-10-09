import { sendText, getBase64FromMediaMessage } from "./whatsapp/client";
import { withTransaction } from "./db";
import {
  setPendingDeleteExpense,
  getPendingDeleteExpense,
  clearPendingDeleteExpense,
  PendingDeleteExpense,
} from "./expenses/pendingDeleteExpense";
import { InvalidAmountError, MAX_REASONABLE_AMOUNT, assertValidAmount, validateAmount } from "./validation";

// Texto de erro pro cliente: valor invalido (zero, negativo ou absurdo) explica
// o motivo de verdade; qualquer outro erro continua no generico.
function userFacingErrorText(err: unknown, fallback = "Deu erro aqui do meu lado tentando processar isso. Tenta de novo em instantes."): string {
  if (err instanceof InvalidAmountError) {
    return err.reason === "not_positive"
      ? "Não consegui registrar: o valor precisa ser maior que R$ 0,00. Me manda de novo com o valor certo."
      : `Não consegui registrar: esse valor passa do limite de R$ ${MAX_REASONABLE_AMOUNT.toLocaleString("pt-BR")}. Confere o valor e me manda de novo.`;
  }
  return fallback;
}
import { transcribeAudio } from "./ai/transcribe";
import {
  interpretText,
  interpretReceiptImage,
  extractCategoryFromAnswer,
  extractPaymentMethodAnswer,
  extractDateTimeFromAnswer,
  extractExpenseInfoFromAnswer,
  extractInstallmentInfoFromAnswer,
  extractReceiptCorrectionFromAnswer,
  Interpretation,
  ReceiptReading,
} from "./ai/interpret";
import {
  createEvent,
  findUpcomingEvents,
  deleteEvent,
  updateEvent,
  listUpcomingEvents,
  getEventById,
  getEventsForMonth,
  formatMinutesBefore,
  listEventReminderMinutes,
  addEventExtraReminder,
  removeEventReminder,
  MAX_REMINDERS_PER_EVENT,
  EventRow,
} from "./events/service";
import {
  createReminder,
  getRemindersWithinDays,
  getRemindersForMonth,
  deleteReminder,
  updateReminder,
  findPendingRemindersByText,
  getReminderById,
  findRecentSentReminders,
  rescheduleReminder,
} from "./reminders/service";
import { setPendingEditEvent, getPendingEditEvent, clearPendingEditEvent, PendingEditEvent } from "./events/pendingEditEvent";
import { EventChangeKey, EventSnapshot, computeProposedEnd, eventChangeText, eventChanges, eventHeader } from "./events/editPlan";
import {
  DURATION_RANGE_TEXT,
  END_NOT_UNDERSTOOD_TEXT,
  EndSpec,
  MAX_EVENT_MINUTES,
  MAX_LOCATION_LENGTH,
  MIN_EVENT_MINUTES,
  parseLocationAnswer,
  resolveEndSpec,
} from "./confirmation/parsers";
import {
  SNOOZE_NOT_FOUND_TEXT,
  computeSnoozeDue,
  formatAlreadyPlayed,
  formatNotPlayedYet,
  formatSnoozeConfirmation,
} from "./reminders/snooze";
import {
  setPendingEditReminder,
  getPendingEditReminder,
  clearPendingEditReminder,
  PendingEditReminder,
} from "./reminders/pendingEditReminder";
import {
  setPendingReminderDeletion,
  getPendingReminderDeletion,
  clearPendingReminderDeletion,
} from "./reminders/pendingDeletion";
import {
  setPendingReminderAdvanceChoice,
  getPendingReminderAdvanceChoice,
  clearPendingReminderAdvanceChoice,
} from "./reminders/pendingAdvanceChoice";
import { setPendingRemoveBudget, getPendingRemoveBudget, clearPendingRemoveBudget, PendingRemoveBudget } from "./expenses/pendingRemoveBudget";
import {
  setPendingRemoveRecurring,
  getPendingRemoveRecurring,
  clearPendingRemoveRecurring,
  PendingRemoveRecurring,
} from "./expenses/pendingRemoveRecurring";
import { currentWeekRange, currentMonthRange, lastNDaysRange, singleDayRange, buildExpenseReportText } from "./expenses/reportText";
import { setBudget, removeBudget, getBudget, listBudgets, checkBudgetAlert } from "./expenses/budgets";
import { setLastShownExpenses, getLastShownExpenses, getLastShownLabel, clearLastShownExpenses } from "./expenses/listCache";
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
  setPendingDeleteCategory,
  getPendingDeleteCategory,
  clearPendingDeleteCategory,
  PendingDeleteCategory,
} from "./expenses/pendingDeleteCategory";
import {
  setPendingEditExpense,
  getPendingEditExpense,
  clearPendingEditExpense,
  PendingEditExpense,
  EditExpenseParams,
  ExpenseEditItem,
} from "./expenses/pendingEditExpense";
import { ExpenseEditField, MAX_EDIT_BATCH, RawChange, mergeRawChanges, normalizeExpenseChanges } from "./expenses/editChanges";
import { buildExpenseEditItem, headerFor } from "./expenses/editItem";
import { FIELD_REGISTRY, FieldDef, MenuKind } from "./fieldMenu/registry";
import { parseFieldSelection } from "./fieldMenu/select";
import {
  FIELD_SELECTION_RETRY,
  MAX_CHOICE_OPTIONS,
  formatFieldMenu,
  formatFieldQuestion,
  formatFieldRetry,
  isChoiceQuestion,
} from "./fieldMenu/format";
import { DateTimeAnswer, LocationAnswer, validateFieldAnswer } from "./fieldMenu/validate";
import { setPendingFieldMenu, getPendingFieldMenu, clearPendingFieldMenu, PendingFieldMenu } from "./fieldMenu/pending";
import { invalidDateMessage, parseExpenseDate } from "./expenses/parseDate";
import { correctionOptions, formatCorrectionPicker, formatExpenseEditPreview, formatExpenseEditSuccess } from "./confirmation/expensePreview";
import {
  createRecurringExpense,
  listRecurringExpenses,
  findActiveRecurringExpenseByDescription,
  findActiveRecurringCandidates,
  getRecurringExpenseById,
  deactivateRecurringExpense,
  updateRecurringExpense,
} from "./expenses/recurring";
import {
  setPendingEditRecurring,
  getPendingEditRecurring,
  clearPendingEditRecurring,
  PendingEditRecurring,
  RecurringExpenseParams,
} from "./expenses/pendingEditRecurring";
import { createBillAlert, listBillAlerts, findActiveBillAlertByName, updateBillAlert, deactivateBillAlert, confirmBillAlertPaid, snoozeBillAlert } from "./bills/service";
import { setPendingBillCheckin, getPendingBillCheckin, clearPendingBillCheckin, PendingBillCheckin } from "./bills/pendingCheckin";
import { setPendingRemoveBillAlert, getPendingRemoveBillAlert, clearPendingRemoveBillAlert, PendingRemoveBillAlert } from "./bills/pendingRemove";
import {
  insertIncome,
  deleteIncome,
  updateIncome,
  getIncomeById,
  findRecentIncome,
  findIncomeCandidates,
  getRecentIncomesList,
  listIncomesBetween,
  getIncomeSummaryBetween,
  IncomeRecord,
} from "./incomes/service";
import { setLastShownIncomes, getLastShownIncomes, clearLastShownIncomes } from "./incomes/listCache";
import {
  setPendingEditIncome,
  getPendingEditIncome,
  clearPendingEditIncome,
  PendingEditIncome,
  IncomeEditField,
  IncomeParams,
  IncomeRawChange,
  normalizeIncomeChanges,
} from "./incomes/pendingEditIncome";
import { setPendingDeleteIncome, getPendingDeleteIncome, clearPendingDeleteIncome, PendingDeleteIncome } from "./incomes/pendingDeleteIncome";
import { buildIncomeEditItem, incomeHeader } from "./incomes/editItem";
import {
  INCOME_DELETE_NOT_UNDERSTOOD,
  INCOME_GONE_TEXT,
  MAX_INCOME_LIST,
  formatIncomeDeletePrompt,
  formatIncomeEditPreview,
  formatIncomeEditSuccess,
  formatIncomeList,
  incomeChangedText,
  incomeCorrectionOptions,
  incomeDeletedText,
  incomeLine,
} from "./confirmation/incomePreview";
import { getRangeBalance } from "./expenses/balance";
import { setPendingEventDeletion, getPendingEventDeletion, clearPendingEventDeletion } from "./events/pendingDeletion";
import { setPendingUndo, getPendingUndo, clearPendingUndo } from "./undo/pendingUndo";
import {
  addPendingCompletion,
  getNextPendingCompletion,
  updatePendingCompletionHead,
  clearHeadPendingCompletion,
  PendingCompletion,
} from "./completion/pendingCompletion";
import {
  setPendingReceiptConfirmation,
  getPendingReceiptConfirmation,
  clearPendingReceiptConfirmation,
  PendingReceiptConfirmation,
} from "./completion/pendingReceiptConfirmation";
import {
  addPendingExpensePaymentMethod,
  getNextPendingExpensePaymentMethod,
  clearHeadPendingExpensePaymentMethod,
  PendingExpensePaymentMethod,
} from "./expenses/pendingPaymentMethod";
import { logActivity } from "./activity/service";
import { isNumberAllowed } from "./access/allowlist";
import { isNumberBlocked } from "./access/blocklist";
import { setPendingEditTarget, getPendingEditTarget, clearPendingEditTarget } from "./pendingEditTarget";
import { classifyConfirmationReply, isCancelWord, normalizeReply } from "./confirmation/classify";
import { setPendingTargetChoice, getPendingTargetChoice, clearPendingTargetChoice, PendingTargetChoice, TargetKind } from "./targetChoice/pending";
import { interpretTargetReply } from "./targetChoice/reply";
import {
  MAX_TARGET_CANDIDATES,
  TARGET_GONE_TEXT,
  TargetListHeader,
  eventLine,
  reminderLine,
  recurringLine,
  expenseLine,
  formatTargetList,
  targetNotUnderstoodText,
  targetMultipleText,
} from "./targetChoice/format";
import { parseBrazilianAmountDetailed, parseLeadTimeMinutes, parseDayOfMonthAnswer } from "./confirmation/parsers";
import {
  NOT_UNDERSTOOD_TEXT,
  CorrectionKind,
  PreviewChange,
  formatBRL,
  formatShortDate,
  formatWhen,
  formatEditPreview,
  expenseHeader,
  recurringHeader,
  correctionQuestion,
  correctionRetry,
  formatCorrectionLabels,
} from "./confirmation/preview";
import { isRateLimited, recordMessageAndCheckLimit } from "./access/rateLimit";
import { shouldAlertOwner } from "./access/ownerAlert";
import { config } from "./config";
import { spDateString, ensureBrazilOffset, addDaysToDateString } from "./timeSP";
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
  listPaymentMethods,
  setReportDayOfWeek,
  parseReminderTime,
  getNoExpenseReminderSettings,
  setNoExpenseReminderEnabled,
  setNoExpenseReminderTime,
  getExpenseSummaryBetween,
  getExpensesBetween,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getRecentExpensesList,
  findInstallmentGroup,
  getExpensesByCategoryId,
  bulkUpdateExpenseCategory,
  searchExpenses,
  deleteCategory,
  renameCategory,
  getPaymentMethodById,
  findExpenseCandidates,
  findPaymentMethodByName,
  findPaymentMethodMentionedIn,
  renamePaymentMethod,
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

Pra ver o que sobrou (entradas menos gastos): "qual meu saldo esse mês"

Pra ver as entradas numeradas: "minhas entradas". Aí é só corrigir ou apagar pelo número: "muda o valor do 2 pra 850" ou "apaga o 2". Também dá pra dizer só "editar" e escolher "Entrada". Antes de mudar ou apagar eu sempre confirmo, e se foi sem querer: "desfaz isso".`;
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

Eu aviso você um tempo antes do horário chegar (60 minutos por padrão), pra não esquecer. Dá pra mudar a antecedência ("me avisa 2 horas antes em vez de 60 minutos"), o nome ou a data/hora: "remarca a consulta pra sexta às 16h" — eu confirmo antes de aplicar. Também dá pra ter até 3 avisos pro mesmo compromisso: "quero ser avisado também 1 dia antes da consulta" adiciona outro, sem tirar o que já existe; "tira o aviso de 1 dia antes" remove só esse. Também dá pra dizer onde é e até que horas vai: "a consulta é na Clínica Sorriso", "a reunião vai até as 17h" ou "a reunião dura 2 horas" (e "tira o local da consulta" pra remover). Pra cancelar o compromisso inteiro, é só dizer, tipo "cancela a consulta do dia 15".`;
    case "reminder":
      return `⏰ Como criar um lembrete:

Diga o que você quer lembrar e quando.

Exemplo: "me lembra de tomar remédio às 20h"

Na hora certa eu mando uma mensagem avisando. Pra mudar o horário de um lembrete já criado: "muda o lembrete do remédio pra amanhã às 21h" — eu confirmo antes de aplicar.

Quando um lembrete tocar e você não puder fazer na hora, é só responder "adia 30 min" ou "adia pra amanhã 9h" — adio na hora, e se foi sem querer: "desfaz isso".`;
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

Eu também mando um resumo automático toda sexta-feira às 9h, e outro no último dia de cada mês, sem você precisar pedir. Pra mudar o dia da semana: "quero receber toda quarta".`;
    case "edit_expense":
      return `✏️ Como corrigir um gasto que você já registrou:

O jeito mais fácil: diga só "editar" (ou "edita o mercado", "edita o 2"). Eu mostro as opções do que dá pra mudar (valor, nome, categoria, data, pagamento) e você escolhe uma ou mais, tipo "1 e 5". Funciona do mesmo jeito pra evento, lembrete e gasto fixo.

Se preferir frases prontas: peça pra ver a lista, dizendo por exemplo "quais gastos eu tive hoje".

Eu mostro os gastos numerados. Depois, é só dizer o que mudar usando o número, tipo "muda o valor do 2 pra 45".

Também dá pra descrever o gasto direto, sem ver a lista antes: "a farmácia foi no pix, não em dinheiro". Isso vale pra qualquer campo — valor, data, forma de pagamento e também o nome/descrição, tipo "muda o nome do último gasto pra Feira".

Dá pra mudar várias coisas de uma vez: "muda o 2 pra 45 e pix" ou "o 3 foi ontem, no crédito". E também mais de um gasto na mesma mensagem (até 5): "o mercado foi no pix e o uber no dinheiro".

Antes de mudar de verdade, eu mostro "antes → depois" e você responde: *1* confirma, *2* corrige (eu pergunto qual e o valor certo) ou *3* cancela. Se foi sem querer, é só dizer "desfaz isso" — volta tudo de uma vez.`;
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

Se tiver qualquer dúvida, é só perguntar, tipo "como faço pra editar um gasto" — eu explico com exemplo.

✋ Se eu entender errado, é só dizer "cancelar" que eu paro de perguntar.

🖥️ Você também pode ver e editar tudo pelo painel no navegador: ${config.dashboardUrl}`;

export async function handleIncomingMessage(data: EvolutionMessage) {
  // Mensagem de grupo (JID termina em @g.us): nunca processa, incondicional --
  // mesmo que alguem aprove um grupo por engano no /admin, essa checagem
  // independente evita o bot responder pra varias pessoas de uma vez.
  if (data.key.remoteJid.endsWith("@g.us")) return;

  const from = data.key.remoteJid.replace(/@s\.whatsapp\.net$/, "");

  // Bloqueado pelo admin: ignora em silencio, sem log nem alerta (justamente o
  // caso de bot em loop, que lotaria o /admin e o WhatsApp do dono).
  if (isNumberBlocked(from)) return;

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
  // sem limite. Ver rateLimit.ts. Enquanto o cooldown de 30 min estiver ativo,
  // toda mensagem cai aqui e sai em silencio -- sem isso, um numero preso em
  // cooldown parecia bug ("mandei e nao aconteceu nada") sem nenhum rastro no
  // /admin pra saber o motivo.
  if (isRateLimited(from)) {
    logActivity(from, "rate_limited", "mensagem ignorada -- ainda dentro do cooldown de 30 min");
    return;
  }
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

  // Log so pra tipos que nao sao texto puro -- imagem, audio, ou qualquer tipo
  // novo que a Evolution API venha a mandar. Mensagem de texto normal ja
  // sempre gera um log significativo mais na frente (expense/event/unknown/
  // error...); esses tipos aqui sao justamente os que podiam passar batido
  // sem deixar NENHUM rastro no /admin se algo desse errado antes de chegar
  // no proprio processamento (ex: imagem que nem cai em nenhum branch tratado).
  if (data.messageType !== "conversation" && data.messageType !== "extendedTextMessage") {
    logActivity(from, "received", `messageType=${data.messageType}`);
  }

  let text: string | undefined;
  if (data.messageType === "conversation" || data.messageType === "extendedTextMessage") {
    text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";
  } else if (data.messageType === "audioMessage") {
    // sem esse try/catch, uma falha aqui (ex: Groq fora do ar) era engolida em
    // silencio pelo .catch() generico do webhook.ts -- mesma classe de bug ja
    // corrigida pra imagem (ver handleReceiptImage), agora tambem coberta aqui.
    try {
      const audioBase64 = await resolveMediaBase64(data);
      if (audioBase64) text = await transcribeAudio(Buffer.from(audioBase64, "base64"));
    } catch (err) {
      console.error("Erro ao transcrever audio:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, "Deu erro aqui do meu lado tentando ouvir esse áudio. Tenta de novo em instantes, ou manda por texto?");
      return;
    }
  }

  // Enquanto tiver categorizacao pendente pra esse numero, a proxima mensagem
  // de texto/audio e tratada como resposta a "qual categoria e isso?", nao como pedido novo.
  if (text !== undefined) {
    // Cada resolvePendingX (17 tipos de pendencia diferentes) cuida do erro
    // dele mesmo quando faz sentido (msgs mais especificas), mas a maioria nao
    // tinha try/catch nenhum -- um erro ali (ex: um valor invalido chegando em
    // parseEditFieldValue/updateExpense, ver assertValidAmount) subia direto
    // pro .catch() generico do webhook.ts, sem log no /admin nem resposta pro
    // cliente. Essa rede de seguranca cobre todos de uma vez; quem ja tem
    // tratamento proprio (categorizacao, forma de pagamento, comprovante)
    // nunca chega a lancar ate aqui.
    try {
    // checado ANTES da fila de categorizacao: e a pergunta mais recente feita
    // ao usuario (so existe depois que uma categoria ja foi resolvida, ver
    // createExpenseAndNotify/resolvePendingCategorization), entao a proxima
    // resposta dele deve resolver essa, nao uma categoria mais antiga na fila.
    // com confirmacao de edicao ativa, "cancelar"/"cancela" fica com o resolver
    // dela (responde "Beleza, nao mexi em nada." / cancela a correcao) em vez do
    // cancelamento geral; as outras saidas de emergencia (esquece, chega...) seguem iguais.
    const activeEdit = describeActiveEditConfirmation(from);
    const deferCancelToEdit = (activeEdit !== null || getPendingTargetChoice(from) !== null) && /^s*cancel(a|ar)s*[.!]*s*$/i.test(text);
    if (CANCEL_COMMAND.test(text) && !deferCancelToEdit) {
      const cancelled = cancelAllPendings(from);
      if (cancelled > 0) {
        logActivity(from, "cancel", `${cancelled} pendencia(s) cancelada(s) pelo usuario`);
        await sendText(from, "Beleza, cancelei o que estava pendente — nada disso foi registrado. Pode mandar uma nova mensagem. 🙂");
        return;
      }
      // nada pendente: em vez de cair no "nao entendi se e gasto, evento ou lembrete"
      logActivity(from, "cancel", "nada pendente pra cancelar");
      await sendText(
        from,
        'Não tem nada pendente pra cancelar agora. 🙂 Se você quer desfazer a última coisa que eu fiz, diga "desfaz isso".'
      );
      return;
    }

    // so a palavra "editar"/"alterar"/"ajustar"/"trocar"... sem dizer o que:
    // pergunta o que editar (em vez de cair no "nao entendi" generico).
    if (BARE_EDIT_COMMAND.test(text)) {
      cancelAllPendings(from);
      setPendingEditTarget(from);
      logActivity(from, "help", "palavra solta de edicao -- perguntou o que editar");
      await sendText(from, EDIT_TARGET_MENU);
      return;
    }

    // comando explicito diferente do que estava pendente: descarta a
    // pendencia (sem avisar "cancelei", ja que o usuario nem sabia que algo
    // tava pendente) e deixa cair na classificacao normal mais abaixo, como
    // se fosse uma mensagem nova -- nao retorna aqui de proposito.
    // Em "aguardando correcao" a mensagem e o novo valor, entao nunca e pedido novo.
    // Com previa de edicao ativa, a frase primeiro e testada como correcao (valor ou
    // data/hora); so se nao der e que a edicao e descartada -- e avisa numa linha.
    if (looksLikeExplicitDifferentRequest(text) && !activeEdit?.awaitingCorrection) {
      const asCorrection =
        activeEdit !== null && acceptsFreeText(activeEdit.kind) ? await interpretCorrection(activeEdit.kind, text) : null;
      if (!asCorrection || "error" in asCorrection) {
        const hadTargetChoice = getPendingTargetChoice(from) !== null;
        const cancelled = cancelAllPendings(from);
        if (cancelled > 0) {
          logActivity(from, "cancel", `${cancelled} pendencia(s) substituida(s) por um pedido explicito diferente: "${text}"`);
          if (activeEdit) await sendText(from, `Cancelei a alteração de "${activeEdit.label}" e entendi seu novo pedido.`);
          else if (hadTargetChoice) await sendText(from, "Cancelei a escolha anterior e entendi seu novo pedido.");
        }
      }
    }

    if (getPendingEditTarget(from)) {
      await resolveEditTargetChoice(from, text);
      return;
    }

    // escolha de item (lista numerada de candidatos): checada ANTES da IA e das
    // outras pendencias, pra "2" ser a escolha e nao outra coisa (RN10)
    const pendingTargetChoice = getPendingTargetChoice(from);
    if (pendingTargetChoice) {
      await resolveTargetChoiceReply(from, pendingTargetChoice, text);
      return;
    }

    // menu guiado de campos (Card 4): item ja escolhido, falta dizer o que mudar
    const pendingFieldMenu = getPendingFieldMenu(from);
    if (pendingFieldMenu) {
      await resolveFieldMenuReply(from, pendingFieldMenu, text);
      return;
    }

    let pendingPaymentMethod = getNextPendingExpensePaymentMethod(from);
    while (pendingPaymentMethod && isPendingExpensePaymentMethodExpired(pendingPaymentMethod)) {
      await finalizePendingExpensePaymentMethodByTimeout(from, pendingPaymentMethod);
      pendingPaymentMethod = getNextPendingExpensePaymentMethod(from);
    }
    if (pendingPaymentMethod) {
      await resolvePendingExpensePaymentMethod(from, pendingPaymentMethod, text);
      return;
    }

    let pending = getNextPendingCategorization(from);
    while (pending && isPendingCategorizationExpired(pending)) {
      await finalizePendingCategorizationByTimeout(from, pending);
      pending = getNextPendingCategorization(from);
    }
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

    const pendingDeleteExpense = getPendingDeleteExpense(from);
    if (pendingDeleteExpense) {
      await resolveDeleteExpenseConfirmation(from, pendingDeleteExpense, text);
      return;
    }

    const pendingDeleteCategory = getPendingDeleteCategory(from);
    if (pendingDeleteCategory) {
      await resolveDeleteCategoryConfirmation(from, pendingDeleteCategory, text);
      return;
    }

    const pendingEditExpense = getPendingEditExpense(from);
    if (pendingEditExpense) {
      await resolveEditExpenseConfirmation(from, pendingEditExpense, text);
      return;
    }

    const pendingEditIncome = getPendingEditIncome(from);
    if (pendingEditIncome) {
      await resolveEditIncomeConfirmation(from, pendingEditIncome, text);
      return;
    }

    const pendingDeleteIncome = getPendingDeleteIncome(from);
    if (pendingDeleteIncome) {
      await resolveDeleteIncomeConfirmation(from, pendingDeleteIncome, text);
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

    const pendingReminderDeletion = getPendingReminderDeletion(from);
    if (pendingReminderDeletion) {
      await resolveReminderDeletionConfirmation(from, pendingReminderDeletion, text);
      return;
    }

    const pendingReminderAdvanceChoice = getPendingReminderAdvanceChoice(from);
    if (pendingReminderAdvanceChoice) {
      await resolveReminderAdvanceChoice(from, pendingReminderAdvanceChoice, text);
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

    const pendingEditRecurring = getPendingEditRecurring(from);
    if (pendingEditRecurring) {
      await resolveEditRecurringConfirmation(from, pendingEditRecurring, text);
      return;
    }

    const pendingRemoveBillAlert = getPendingRemoveBillAlert(from);
    if (pendingRemoveBillAlert) {
      await resolveRemoveBillAlertConfirmation(from, pendingRemoveBillAlert, text);
      return;
    }

    const pendingBillCheckin = getPendingBillCheckin(from);
    if (pendingBillCheckin) {
      await resolveBillCheckinAnswer(from, pendingBillCheckin, text);
      return;
    }

    const pendingReceipt = getPendingReceiptConfirmation(from);
    if (pendingReceipt) {
      await resolvePendingReceiptConfirmation(from, pendingReceipt, text);
      return;
    }
    } catch (err) {
      console.error("Erro ao resolver pendencia:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, userFacingErrorText(err));
      return;
    }
  }

  if (data.messageType === "imageMessage") {
    try {
      const imageBase64 = await resolveMediaBase64(data);
      if (!imageBase64) {
        await sendText(from, "Não consegui baixar essa imagem. Tenta mandar de novo?");
        return;
      }
      const mimeType = data.message?.imageMessage?.mimetype ?? "image/jpeg";
      await handleReceiptImage(from, imageBase64, mimeType);
    } catch (err) {
      // sem isso, um erro aqui (ex: falha na chamada da IA, imagem corrompida)
      // era engolido em silencio pelo .catch() do webhook.ts -- nunca aparecia
      // no /admin nem virava resposta pro usuario, so um log no console do
      // servidor (inacessivel sem entrar no container). Ver relato em producao:
      // foto enviada, numero liberado, mas SEM resposta e SEM linha no /admin.
      console.error("Erro ao processar imagem de comprovante:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, "Deu erro aqui do meu lado tentando ler essa imagem. Tenta de novo em instantes.");
    }
    return;
  }

  let interpretations: Interpretation[];
  if (text !== undefined) {
    // mesma logica do audio/imagem: sem isso, uma falha na classificacao (ex:
    // Anthropic fora do ar) era engolida em silencio pelo .catch() generico do
    // webhook.ts, sem log nenhum no /admin e sem resposta pro cliente.
    try {
      interpretations = await interpretText(from, text);
    } catch (err) {
      console.error("Erro ao interpretar mensagem:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, "Deu erro aqui do meu lado tentando entender essa mensagem. Tenta de novo em instantes.");
      return;
    }
  } else {
    logActivity(from, "unsupported_type", `messageType=${data.messageType}`);
    await sendText(from, "Por enquanto so entendo texto, audio e imagem de comprovante. 🙂");
    return;
  }

  // Uma mensagem pode conter varios pedidos (ex: "marca dentista amanha e reuniao sexta");
  // processa cada acao separadamente, uma falha nao impede as outras. Gastos
  // completos (2+) sao tentados em LOTE primeiro, pra confirmar todos numa
  // mensagem so em vez de uma por gasto (ver tryCreateExpenseBatch) -- os
  // demais pedidos da mensagem (nao-gasto) continuam vindo depois, um a um.
  const expenseActions = interpretations.filter((i): i is Extract<Interpretation, { type: "expense" }> => i.type === "expense");
  const otherActions = interpretations.filter((i) => i.type !== "expense");

  if (expenseActions.length > 1) {
    let batched = false;
    try {
      batched = await tryCreateExpenseBatch(from, expenseActions);
    } catch (err) {
      console.error("Erro ao processar lote de gastos:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, userFacingErrorText(err));
      batched = true; // um erro aqui pode ja ter inserido alguns gastos -- nao tenta de novo um por um pra nao duplicar
    }
    if (!batched) await processInterpretations(from, expenseActions);
    await processInterpretations(from, otherActions);
    return;
  }

  await processInterpretations(from, interpretations);
}

const EDIT_ACTION_TYPES = new Set<Interpretation["type"]>([
  "edit_event",
  "edit_reminder",
  "edit_recurring_expense",
  "edit_expense",
  "correct_category",
  "edit_income",
  "delete_income",
]);

function editRequestLabel(interpretation: Interpretation): string {
  if (interpretation.type === "edit_expense" && interpretation.list_ref) return `gasto ${interpretation.list_ref}`;
  if ((interpretation.type === "edit_income" || interpretation.type === "delete_income") && interpretation.list_ref) return `entrada ${interpretation.list_ref}`;
  return (interpretation as { query?: string }).query || "esse item";
}

// RN10: o que ainda esta esperando resposta (confirmacao de edicao ou escolha de item)
function pendingEditBlockerLabel(from: string): string | null {
  const active = describeActiveEditConfirmation(from);
  if (active) return active.label;
  const choice = getPendingTargetChoice(from);
  return choice ? editRequestLabel(choice.action) : null;
}

async function processInterpretations(from: string, items: Interpretation[]) {
  const expenseEdits = items.filter(isExpenseEditAction);
  const batchEdits = expenseEdits.length >= 2;
  let batchDone = false;
  let editStarted = false;

  for (const interpretation of items) {
    try {
      if (batchEdits && isExpenseEditAction(interpretation) && batchDone) continue;

      // RN10: so uma confirmacao de edicao por vez -- a segunda edicao da mesma
      // mensagem nao pode apagar a primeira que ainda espera resposta
      if (editStarted && EDIT_ACTION_TYPES.has(interpretation.type)) {
        const blocker = pendingEditBlockerLabel(from);
        if (blocker !== null) {
          const skipped = batchEdits && isExpenseEditAction(interpretation) ? "gastos" : editRequestLabel(interpretation);
          logActivity(from, interpretation.type, `adiado: confirmacao de "${blocker}" ainda pendente`);
          await sendText(from, `Deixei a alteração de "${skipped}" pra depois: confirma a de "${blocker}" primeiro e me pede de novo.`);
          if (batchEdits && isExpenseEditAction(interpretation)) batchDone = true;
          continue;
        }
      }

      if (batchEdits && isExpenseEditAction(interpretation)) {
        batchDone = true;
        editStarted = true;
        await startExpenseEditBatch(from, expenseEdits);
        continue;
      }
      if (EDIT_ACTION_TYPES.has(interpretation.type)) editStarted = true;
      await handleInterpretation(from, interpretation);
    } catch (err) {
      console.error("Erro ao processar interpretacao:", err);
      logActivity(from, "error", err instanceof Error ? err.message : String(err));
      await sendText(from, userFacingErrorText(err));
    }
  }
}

// Se a mensagem mencionou a forma de pagamento, usa ela (cria se for nova).
// Senao, cai pro padrao do usuario, se tiver configurado -- usado em silencio,
// sem perguntar de novo (pedido explicito). Sem mencao e sem padrao: se sobrar
// EXATAMENTE 1 forma cadastrada, usa ela sozinha e ja marca como padrao (nunca
// deveria ter ficado ambigua com 1 opcao so). Com 0 ou 2+ formas restantes,
// devolve null -- quem chamou decide se pergunta (ver askPaymentMethod).
function autoResolvePaymentMethod(from: string, mentioned?: string | null) {
  if (mentioned) return getOrCreatePaymentMethod(from, mentioned);
  const defaultMethod = getDefaultPaymentMethod(from);
  if (defaultMethod) return defaultMethod;
  const methods = listPaymentMethods(from);
  if (methods.length === 1) {
    setDefaultPaymentMethod(from, methods[0].id);
    return methods[0];
  }
  return null;
}

// Pergunta a forma de pagamento de um gasto ja resolvido (valor/descricao/
// categoria certos, so falta a forma) -- combinada na MESMA mensagem com a
// oferta de deixar a resposta como padrao pras proximas vezes, pra nao
// precisar de uma segunda pergunta de confirmacao so pra isso.
function paymentMethodQuestionText(from: string, amount: number, description: string): string {
  const methodNames = listPaymentMethods(from)
    .map((m) => m.name)
    .join(", ");
  return `Qual foi a forma de pagamento desse gasto de R$${amount.toFixed(2)} (${description})?\n\nFormas cadastradas: ${methodNames}\n\nPode responder com uma dessas ou dizer uma nova -- e já deixo essa como sua forma padrão pras próximas vezes. (Pra desistir, diga "cancelar".)`;
}

// Tempo maximo esperando "qual categoria e isso?" antes de decidir sozinho.
// Bem mais curto que os outros caches de conversa (5min) de proposito: essa
// fila e checada em 1o lugar em TODA mensagem futura do numero (ver
// handleIncomingMessage), entao se ficar pendente por muito tempo, qualquer
// coisa que o cliente mandar depois -- um gasto novo, um evento, um "oi" --
// seria tratada como resposta de categoria, travando o numero pra sempre
// (bug real encontrado na auditoria: src/expenses/service.ts + prioridade da
// fila em handleIncomingMessage).
const PENDING_CATEGORIZATION_TTL_MS = 30 * 1000;

function isPendingCategorizationExpired(pending: PendingCategorization): boolean {
  return Date.now() - new Date(pending.created_at).getTime() > PENDING_CATEGORIZATION_TTL_MS;
}

// Passou o prazo sem resposta: em vez de deixar a pergunta pendente pra
// sempre (ou simplesmente descartar o gasto, perdendo o que o cliente
// registrou), salva sozinho usando a categoria sugerida (a que veio na
// mensagem original, se veio) -- ou "Outros" se nao tinha nenhuma -- e AVISA
// o que foi feito, do mesmo jeito que uma confirmacao normal, pro cliente
// poder corrigir se a categoria ficou errada.
async function finalizePendingCategorizationByTimeout(from: string, pending: PendingCategorization) {
  try {
    const category = getOrCreateCategory(from, pending.suggested_category ?? "Outros");
    const paymentMethod = autoResolvePaymentMethod(from, pending.suggested_payment_method);
    clearPendingCategorization(from, pending.id);
    const { budgetAlert } = recordSimpleExpense(from, {
      amount: pending.amount,
      description: pending.description,
      date: pending.date,
      categoryId: category.id,
      categoryName: category.name,
      paymentMethod,
      logNote: "categorizado automaticamente, sem resposta a tempo",
    });
    await sendText(
      from,
      `⏱️ Não recebi a categoria a tempo, então registrei como "${category.name}": ${formatExpenseConfirmation({
        amount: pending.amount,
        description: pending.description,
        categoryName: category.name,
        date: pending.date,
        paymentMethodName: paymentMethod?.name ?? null,
      })}${budgetAlert}\n\nSe não for essa a categoria certa, é só me falar pra eu corrigir.`
    );
  } catch (err) {
    console.error("Erro ao finalizar categorizacao pendente por timeout:", err);
    logActivity(from, "error", err instanceof Error ? err.message : String(err));
    clearPendingCategorization(from, pending.id);
  }
}

// Sempre os mesmos 5 campos, na mesma ordem, em toda confirmacao de gasto
// avulso -- pedido explicito do usuario (nao importa qual caminho resolveu
// cada campo: direto, depois de perguntar categoria, depois de perguntar
// forma de pagamento, ou pelo timeout da fila de categorizacao).
function formatExpenseConfirmation(params: {
  amount: number;
  description: string;
  categoryName: string;
  date: string;
  paymentMethodName: string | null;
}): string {
  const paymentLabel = params.paymentMethodName ?? "não definida";
  return `R$${params.amount.toFixed(2)} — ${params.description}\nCategoria: ${params.categoryName}\nData: ${formatDateOnly(params.date)}\nForma de pagamento: ${paymentLabel}`;
}

// Grava o gasto de verdade (categoria e forma de pagamento ja resolvidas) e os
// efeitos colaterais em comum (undo, log, alerta de orcamento) -- SEM mandar
// mensagem nenhuma, ja que cada caminho que chega aqui usa um texto de
// confirmacao proprio (ver formatExpenseConfirmation) em volta desse resultado.
function recordSimpleExpense(
  from: string,
  params: {
    amount: number;
    description: string;
    date: string;
    categoryId: number;
    categoryName: string;
    paymentMethod: { id: number; name: string } | null;
    logNote?: string;
  }
) {
  const created = insertExpense({
    fromNumber: from,
    amount: params.amount,
    description: params.description,
    categoryId: params.categoryId,
    paymentMethodId: params.paymentMethod?.id ?? null,
    date: params.date,
  });
  setPendingUndo(from, {
    kind: "delete_expense",
    expenseId: created.id,
    description: `R$${params.amount.toFixed(2)} em ${params.categoryName} — ${params.description}`,
  });
  const paymentSuffix = params.paymentMethod ? ` via ${params.paymentMethod.name}` : "";
  const noteSuffix = params.logNote ? ` (${params.logNote})` : "";
  logActivity(from, "expense", `R$${params.amount.toFixed(2)} em ${params.categoryName}${paymentSuffix} — ${params.description}${noteSuffix}`);
  const budgetAlert = checkBudgetAlert(from, params.categoryId, params.categoryName) ?? "";
  return { created, budgetAlert };
}

// "cancelar"/"para"/"deixa pra la"... -- saida de emergencia: enquanto o bot
// esta esperando uma resposta (categoria, forma de pagamento, confirmacao...),
// qualquer texto vira a resposta, e um "para" virava categoria/forma de
// pagamento ou ficava sendo insistido. Vale so pra mensagem INTEIRA curta,
// nao pra frase que so contem essas palavras (ex: "cancela o evento X").
const CANCEL_COMMAND =
  /^\s*(cancel(a|ar|o)|par(a|ar|e)|esque[cç]a?|esquece(r)?|desconsidera|ignora|chega|deixa\s+(pra|para)\s+l[aá]|deixa\s+quieto|deixa\s+isso|n[aã]o\s+quero\s+mais|esquece\s+isso)(\s+(isso|tudo|por\s+favor|pf|pfv))?\s*[.!]*\s*$/i;

// Achado real: "somente editar essa forma de pagamento para PIX" (claramente
// um comando explicito, nao uma resposta curta) foi engolido como resposta a
// uma pendencia completamente diferente (fila de completar gasto parcial),
// virando um gasto fantasma com valor reaproveitado de outra compra. Mensagem
// LONGA (5+ palavras) com um verbo de EDITAR/CORRIGIR explicito tem muito mais
// cara de comando novo do que de resposta direta (respostas a pendencia sao
// tipicamente curtas: "pix", "mercado", "sim", "45") -- mesma logica do
// CANCEL_COMMAND (explicito vence o que estiver pendente), mas pra "na
// verdade quero outra coisa" em vez de "esquece".
const EXPLICIT_EDIT_VERB = /\b(edita|editar|corrij[ao]|corrigir|altera|alterar|troca|trocar|muda|mudar|renomei[ae]|renomear)\b/i;

// Mensagem que e SO um verbo de edicao ("editar", "alterar", "ajustar", "trocar",
// "mudar"...), opcionalmente com "quero"/"preciso" na frente e "algo"/"uma coisa"
// atras. Nao pega frase com mais conteudo (essas vao pra IA normalmente).
const BARE_EDIT_COMMAND =
  /^\s*((quero|preciso|queria|gostaria\s+de|vou|posso)\s+)?(edit(ar|a)|alter(ar|a)|ajust(ar|a)|troc(ar|a)|mud(ar|a|e)|corrig(ir|e)|modific(ar|a)|atualiz(ar|a))(\s+(algo|alguma\s+coisa|uma\s+coisa|isso|tudo|um\s+registro|um\s+item|um\s+dado))?\s*[.!?]*\s*$/i;

const EDIT_TARGET_MENU =
  'O que você quer editar?\n\n1. Gasto\n2. Categoria\n3. Forma de pagamento\n4. Evento na agenda\n5. Lembrete\n6. Alerta de conta (vencimento)\n7. Gasto fixo (lançado todo mês)\n8. Entrada (dinheiro que entrou)\n\nResponde com o número ou o nome (ou "cancelar").';

type EditTarget = "expense" | "category" | "payment_method" | "event" | "reminder" | "bill_alert" | "recurring" | "income";

function parseEditTarget(answer: string): EditTarget | null {
  const t = answer
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (/^[1-8]\D*$/.test(t)) {
    return (["expense", "category", "payment_method", "event", "reminder", "bill_alert", "recurring", "income"] as const)[Number(t.replace(/\D/g, "")) - 1];
  }
  if (/gasto\s+fixo|despesa\s+fixa|recorrente/.test(t)) return "recurring";
  if (/entrada|entrou|receita|recebi|recebimento|salario/.test(t)) return "income";
  if (/conta|alerta|boleto|fatura/.test(t)) return "bill_alert";
  if (/categori/.test(t)) return "category";
  if (/pagamento|cartao|pix|dinheiro|credito|debito/.test(t)) return "payment_method";
  if (/evento|agenda|compromisso|consulta|reuniao/.test(t)) return "event";
  if (/lembrete|aviso/.test(t)) return "reminder";
  if (/gasto|compra|despesa/.test(t)) return "expense";
  return null;
}

// resposta ao "o que voce quer editar?": gasto, evento, lembrete e gasto fixo
// mostram a lista numerada (escolha do item -> menu de campos); categoria, forma
// de pagamento e alerta de conta continuam mostrando o que existe + frase de exemplo.
async function resolveEditTargetChoice(from: string, answerText: string) {
  const target = parseEditTarget(answerText);
  if (!target) {
    await sendText(from, `Não entendi o que você quer editar. ${EDIT_TARGET_MENU}`);
    return;
  }
  clearPendingEditTarget(from);
  logActivity(from, "help", `escolheu editar: ${target}`);

  if (target === "expense" || target === "event" || target === "reminder" || target === "recurring" || target === "income") {
    await offerBrowseList(from, target);
    return;
  }
  if (target === "category") {
    const categories = listCategories(from);
    const lines = categories.length ? categories.map((c) => `• ${c.name}`).join("\n") : "(nenhuma ainda)";
    await sendText(
      from,
      `Suas categorias:\n\n${lines}\n\nEx: "renomeia a categoria Mercado pra Supermercado". Pra trocar a categoria de um gasto: "muda a categoria do último gasto pra lazer".`
    );
    return;
  }
  if (target === "payment_method") {
    const methods = listPaymentMethods(from);
    const lines = methods.length ? methods.map((m) => `• ${m.name}`).join("\n") : "(nenhuma ainda)";
    await sendText(
      from,
      `Suas formas de pagamento:\n\n${lines}\n\nEx: "renomeia o cartão nubank pra cartão roxo". Pra trocar a forma de pagamento de um gasto: "muda a forma de pagamento do último gasto pra pix".`
    );
    return;
  }
  const bills = listBillAlerts(from);
  const lines = bills.length
    ? bills.map((b) => `• ${b.name} — ${b.recurrence_type === "interval" ? `a cada ${b.interval_days} dias` : `todo dia ${b.day_of_month}`}`).join("\n")
    : "(nenhuma conta fixa cadastrada)";
  await sendText(
    from,
    `Seus alertas de conta (vencimento):\n\n${lines}\n\nEx: "muda o alerta da água pro dia 8" ou "renomeia o alerta da luz pra Energia". Pra gastos fixos lançados sozinhos, escolha a opção 7 do menu "editar".`
  );
}

function looksLikeExplicitDifferentRequest(message: string): boolean {
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  return wordCount >= 5 && EXPLICIT_EDIT_VERB.test(message);
}

// Descarta TODAS as perguntas pendentes desse numero (menos o alerta de conta
// fixa, que e o bot puxando assunto por conta propria e tem sua propria
// resposta "ja fez / amanha") e devolve quantas eram. Nada do que estava
// pendente e registrado.
function cancelAllPendings(from: string): number {
  let cleared = 0;
  while (getNextPendingExpensePaymentMethod(from)) {
    clearHeadPendingExpensePaymentMethod(from);
    cleared++;
  }
  let categorization = getNextPendingCategorization(from);
  while (categorization) {
    clearPendingCategorization(from, categorization.id);
    cleared++;
    categorization = getNextPendingCategorization(from);
  }
  while (getNextPendingCompletion(from)) {
    clearHeadPendingCompletion(from);
    cleared++;
  }
  const simple: Array<[unknown, () => void]> = [
    [getPendingListChoice(from), () => clearPendingListChoice(from)],
    [getPendingEventDeletion(from), () => clearPendingEventDeletion(from)],
    [getPendingBulkRecategorize(from), () => clearPendingBulkRecategorize(from)],
    [getPendingMergeCategories(from), () => clearPendingMergeCategories(from)],
    [getPendingDeleteCategory(from), () => clearPendingDeleteCategory(from)],
    [getPendingDeleteExpense(from), () => clearPendingDeleteExpense(from)],
    [getPendingEditExpense(from), () => clearPendingEditExpense(from)],
    [getPendingEditIncome(from), () => clearPendingEditIncome(from)],
    [getPendingDeleteIncome(from), () => clearPendingDeleteIncome(from)],
    [getPendingEditEvent(from), () => clearPendingEditEvent(from)],
    [getPendingEditReminder(from), () => clearPendingEditReminder(from)],
    [getPendingReminderDeletion(from), () => clearPendingReminderDeletion(from)],
    [getPendingReminderAdvanceChoice(from), () => clearPendingReminderAdvanceChoice(from)],
    [getPendingRemoveBudget(from), () => clearPendingRemoveBudget(from)],
    [getPendingRemoveRecurring(from), () => clearPendingRemoveRecurring(from)],
    [getPendingEditRecurring(from), () => clearPendingEditRecurring(from)],
    [getPendingEditTarget(from) || null, () => clearPendingEditTarget(from)],
    [getPendingTargetChoice(from), () => clearPendingTargetChoice(from)],
    [getPendingFieldMenu(from), () => clearPendingFieldMenu(from)],
    [getPendingRemoveBillAlert(from), () => clearPendingRemoveBillAlert(from)],
    [getPendingReceiptConfirmation(from), () => clearPendingReceiptConfirmation(from)],
  ];
  for (const [pendingState, clear] of simple) {
    if (pendingState) {
      clear();
      cleared++;
    }
  }
  return cleared;
}

function askForCategory(from: string, amount: number, description: string) {
  const categoryNames = listCategories(from)
    .map((c) => c.name)
    .join(", ");
  return sendText(
    from,
    `Qual categoria é esse gasto de R$${amount.toFixed(2)} (${description})?\n\nCategorias: ${categoryNames}\n\nPode responder com uma dessas ou dizer uma categoria nova. (Pra desistir, diga "cancelar".)`
  );
}

// Cria o gasto de verdade (ou entra na fila de categorizacao se nao souber a
// categoria, ou pergunta a forma de pagamento se ficar ambigua). Extraido do
// case "expense" pra ser reaproveitado tambem quando um gasto parcial
// (faltando valor ou descricao) termina de ser completado, e pela leitura de
// nota fiscal (com skipPaymentMethodPrompt=true, ver finalizeReceiptExpense --
// aquele fluxo ja tem sua propria pergunta/opcao de pular a forma de pagamento
// antes de chegar aqui, entao nao faz sentido perguntar de novo).
async function createExpenseAndNotify(
  from: string,
  params: { amount: number; description: string; date: string; category?: string; payment_method?: string; skipPaymentMethodPrompt?: boolean }
) {
  // valida ANTES de perguntar categoria/forma de pagamento -- senao um gasto de
  // R$0 passava por 2 perguntas pro usuario so pra falhar no final
  assertValidAmount(params.amount);
  const keywordHints = [params.category, params.description].filter((hint): hint is string => Boolean(hint));
  const category = (params.category && findCategoryByName(from, params.category)) || findCategoryByKeyword(from, ...keywordHints);

  if (category) {
    const paymentMethod = autoResolvePaymentMethod(from, params.payment_method);
    if (!paymentMethod && !params.skipPaymentMethodPrompt) {
      const isHead = addPendingExpensePaymentMethod(from, {
        amount: params.amount,
        description: params.description,
        date: params.date,
        categoryId: category.id,
        categoryName: category.name,
      });
      logActivity(from, "expense", `categoria resolvida (${category.name}), forma de pagamento pendente: R$${params.amount.toFixed(2)} — ${params.description}`);
      // se ja tem outro gasto esperando forma de pagamento (ex: lote que
      // desistiu por causa disso, ver tryCreateExpenseBatch), so entra na
      // fila -- a pergunta em si so sai quando chegar a vez dele (ver
      // resolvePendingExpensePaymentMethod)
      if (isHead) await sendText(from, paymentMethodQuestionText(from, params.amount, params.description));
      return;
    }
    const { budgetAlert } = recordSimpleExpense(from, {
      amount: params.amount,
      description: params.description,
      date: params.date,
      categoryId: category.id,
      categoryName: category.name,
      paymentMethod,
    });
    await sendText(
      from,
      `✅ Gasto registrado: ${formatExpenseConfirmation({
        amount: params.amount,
        description: params.description,
        categoryName: category.name,
        date: params.date,
        paymentMethodName: paymentMethod?.name ?? null,
      })}${budgetAlert}`
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

// Confirma um lote de 2+ gastos completos vindos da MESMA mensagem numa unica
// resposta (ex: "gastei 50 no mercado e 30 de uber" -> "✅ 2 gastos
// registrados: ..."), em vez de uma confirmacao por gasto. So ativa quando
// TODOS conseguem resolver categoria sozinhos (por nome dito ou palavra-chave
// ja aprendida) -- se qualquer um precisar perguntar a categoria, desiste do
// lote (retorna false, sem inserir nada) e cada gasto cai de volta no fluxo
// normal, um por vez (fila de categorizacao ja existente), pra nao complicar
// perguntar categoria de varios ao mesmo tempo.
//
// Registra o lote como "ultima lista mostrada" (mesmo mecanismo de
// list_expenses/getLastShownExpenses), entao da pra editar um especifico
// depois SEM mexer nos outros (ex: "muda o valor do 2 pra 45") -- e se o
// usuario pedir pra mudar mais de um de uma vez (ex: "muda o 1 pra pix e o 2
// pra dinheiro"), isso ja funciona sozinho: vira duas acoes edit_expense
// separadas no mesmo pedido, cada uma seguindo seu proprio fluxo de
// confirmacao normal. O "desfaz isso" tambem trata o lote inteiro como uma
// unidade so (kind delete_expenses_batch), removendo todos de uma vez.
async function tryCreateExpenseBatch(from: string, items: Extract<Interpretation, { type: "expense" }>[]): Promise<boolean> {
  type ResolvedExpense = {
    amount: number;
    description: string;
    date: string;
    category: { id: number; name: string };
    paymentMethod: { id: number; name: string } | null;
  };

  const resolved: ResolvedExpense[] = [];
  for (const item of items) {
    assertValidAmount(item.amount);
    const description = item.description?.trim() || item.category;
    if (!description) return false; // sem descricao nenhuma, nem da categoria -- nao deveria classificar como expense assim, mas por seguranca cai pro fluxo normal
    const keywordHints = [item.category, description].filter((hint): hint is string => Boolean(hint));
    const category = (item.category && findCategoryByName(from, item.category)) || findCategoryByKeyword(from, ...keywordHints);
    if (!category) return false;
    const paymentMethod = autoResolvePaymentMethod(from, item.payment_method);
    if (!paymentMethod) return false; // forma de pagamento ambigua -- desiste do lote, cada gasto pergunta a sua individualmente (fluxo normal)
    resolved.push({
      amount: item.amount,
      description,
      date: item.date || spDateString(),
      category,
      paymentMethod,
    });
  }

  const expenseIds: number[] = [];
  const budgetAlerts: string[] = [];
  // achado da auditoria: sem transacao, uma falha no meio do loop deixava
  // alguns gastos do lote gravados e outros nao, sem limpeza automatica.
  const lines = withTransaction(() =>
    resolved.map((r, idx) => {
      const created = insertExpense({
        fromNumber: from,
        amount: r.amount,
        description: r.description,
        categoryId: r.category.id,
        paymentMethodId: r.paymentMethod?.id ?? null,
        date: r.date,
      });
      expenseIds.push(created.id);
      const paymentSuffix = r.paymentMethod ? ` via ${r.paymentMethod.name}` : "";
      logActivity(from, "expense", `R$${r.amount.toFixed(2)} em ${r.category.name}${paymentSuffix} — ${r.description}`);
      const budgetAlert = checkBudgetAlert(from, r.category.id, r.category.name);
      if (budgetAlert) budgetAlerts.push(budgetAlert);
      return `${idx + 1}. R$${r.amount.toFixed(2)} em ${r.category.name} — ${r.description} (${formatDateOnly(r.date)}${paymentSuffix})`;
    })
  );

  setLastShownExpenses(from, expenseIds);
  setPendingUndo(from, {
    kind: "delete_expenses_batch",
    expenseIds,
    description: resolved.map((r) => `R$${r.amount.toFixed(2)} em ${r.category.name}`).join(", "),
  });

  await sendText(
    from,
    `✅ ${resolved.length} gastos registrados:\n${lines.join("\n")}${budgetAlerts.join("")}\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45".`
  );
  return true;
}

// Cria o evento de verdade. Extraido do case "event" pra ser reaproveitado
// tambem quando um evento parcial (faltando dia e/ou horario) termina de ser
// completado (ver resolvePendingCompletion).
async function createEventAndNotify(
  from: string,
  params: { title: string; start: string; end?: string; location?: string; reminderMinutes?: number }
) {
  // a IA/o merge devolve o horario em hora local de Brasilia mas nem sempre
  // com o offset explicito -03:00; sem isso, o resto do sistema pode tratar
  // como UTC e adiantar o evento em 3h (ver ensureBrazilOffset em timeSP.ts)
  const start = ensureBrazilOffset(params.start);
  const end = params.end ? ensureBrazilOffset(params.end) : undefined;
  const created = createEvent({
    fromNumber: from,
    title: params.title,
    start,
    end,
    location: params.location,
    reminderMinutes: params.reminderMinutes,
  });
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
  const paymentMethod = autoResolvePaymentMethod(from, params.payment_method);
  // achado da auditoria: sem transacao, uma falha no meio do loop deixava
  // algumas parcelas gravadas e outras nao, sem limpeza automatica.
  const expenseIds = withTransaction(() =>
    amounts.map(
      (amount, i) =>
        insertExpense({
          fromNumber: from,
          amount,
          description: `${params.description} (parcela ${i + 1}/${params.installments})`,
          categoryId: category.id,
          paymentMethodId: paymentMethod?.id ?? null,
          date: addMonthsToDateString(params.date, i),
        }).id
    )
  );

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

// Campos comuns a um gasto lido de foto de comprovante (sem o estado de
// controle da pendencia -- 'awaiting'/'createdAt'). PendingReceiptConfirmation
// satisfaz esse formato naturalmente (tipagem estrutural), entao as funcoes
// abaixo aceitam tanto o pending inteiro quanto um objeto mais simples.
type ReceiptFields = {
  description: string;
  date: string;
  totalAmount: number;
  category?: string;
  paymentMethod?: string;
};

function receiptAmountLabel(fields: ReceiptFields): string {
  return `R$${fields.totalAmount.toFixed(2)}`;
}

function receiptCategoryQuestionText(from: string, fields: ReceiptFields): string {
  const categoryNames = listCategories(from)
    .map((c) => c.name)
    .join(", ");
  const amountLabel = receiptAmountLabel(fields);
  return `📷 Não identifiquei a categoria dessa compra${amountLabel ? ` de ${amountLabel}` : ""} (${fields.description}). Qual categoria é?\n\nCategorias: ${categoryNames}\n\nPode responder com uma dessas ou dizer uma categoria nova.`;
}

function receiptPaymentMethodQuestionText(fields: ReceiptFields): string {
  const amountLabel = receiptAmountLabel(fields);
  return `📷 Não consegui ler a forma de pagamento no comprovante${amountLabel ? ` (${amountLabel}, ${fields.description})` : ""}. Foi no Pix, débito, crédito, dinheiro...?`;
}

function receiptConfirmationSummaryText(from: string, fields: ReceiptFields, retry = false): string {
  const amountLabel = receiptAmountLabel(fields);
  // se a forma de pagamento nao veio explicita nessa pendencia, mostra a que
  // vai ser usada de qualquer jeito ao finalizar (padrao ja definido, ou a
  // unica forma cadastrada -- ver autoResolvePaymentMethod), pra nao sumir
  // essa informacao da previa so porque nao precisou perguntar.
  const resolvedPaymentName = fields.paymentMethod ?? autoResolvePaymentMethod(from)?.name;
  const paymentLabel = resolvedPaymentName ? `, no ${resolvedPaymentName}` : "";
  const prefix = retry ? "Não entendi — confirma assim: " : "📷 Li assim: ";
  return `${prefix}${amountLabel} em ${fields.description} (${fields.category}${paymentLabel}), dia ${formatDateOnly(fields.date)}. Confirma? Responde "sim"/"não", ou me diga o que corrigir.`;
}

// Registra de verdade um gasto lido de foto de comprovante, ja confirmado --
// reaproveita createExpenseAndNotify (undo, alerta de orcamento e mensagem de
// confirmacao ja vem de graca dali). Sempre um unico gasto, nunca parcelado --
// uma foto so traz o valor TOTAL geral (ver interpretReceiptImage).
async function finalizeReceiptExpense(from: string, pending: PendingReceiptConfirmation) {
  await createExpenseAndNotify(from, {
    amount: pending.totalAmount,
    description: pending.description,
    date: pending.date,
    category: pending.category,
    payment_method: pending.paymentMethod,
    // esse fluxo ja tem sua propria pergunta de forma de pagamento (com opcao
    // de "nao sei"/pular, ver handleReceiptImage/resolvePendingReceiptConfirmation)
    // antes de chegar aqui -- nao faz sentido perguntar de novo se ainda ficar ambiguo.
    skipPaymentMethodPrompt: true,
  });
}

// Le a foto de comprovante e monta a pendencia de confirmacao -- SEMPRE passa
// por confirmacao antes de registrar (foto erra mais que texto digitado).
// A leitura da imagem traz valor total, data, local e uma categoria unica
// (inferida pelo estabelecimento/tipo geral dos itens, nunca item por item --
// ver interpretReceiptImage) -- forma de pagamento nunca vem da foto, sempre
// perguntada por texto aqui. Se a IA nao arriscou categoria, tenta ainda por
// palavra-chave ja aprendida desse numero antes de perguntar.
async function handleReceiptImage(from: string, imageBase64: string, mimeType: string) {
  const reading = await interpretReceiptImage(from, imageBase64, mimeType);
  if (!reading.isReceipt) {
    logActivity(from, "receipt", "imagem nao reconhecida como comprovante de compra");
    await sendText(
      from,
      'Não consegui ler essa foto como nota fiscal/comprovante. Pode reenviar mais nítida, ou digitar o gasto (ex: "50 no mercado")?'
    );
    return;
  }

  const resolvedCategory = (reading.category && findCategoryByName(from, reading.category)) || findCategoryByKeyword(from, reading.description);

  const base: ReceiptFields = {
    description: reading.description,
    date: reading.date,
    totalAmount: reading.totalAmount,
    category: resolvedCategory?.name,
  };

  if (!base.category) {
    setPendingReceiptConfirmation(from, { ...base, awaiting: "category" });
    logActivity(from, "receipt", `lido da imagem, categoria desconhecida -- pedindo (${base.description})`);
    await sendText(from, receiptCategoryQuestionText(from, base));
    return;
  }
  // so pergunta se ainda ficar ambigua depois do auto-resolve (padrao ja
  // definido, ou so 1 forma cadastrada) -- mesma logica usada no resto do
  // sistema, ver autoResolvePaymentMethod. Resolvido sozinho, nem passa por
  // "payment_method" aqui: createExpenseAndNotify usa o padrao/unica forma
  // direto ao finalizar (ver finalizeReceiptExpense).
  if (!base.paymentMethod && !autoResolvePaymentMethod(from)) {
    setPendingReceiptConfirmation(from, { ...base, awaiting: "payment_method" });
    logActivity(from, "receipt", `lido da imagem, forma de pagamento desconhecida -- pedindo (${base.description})`);
    await sendText(from, receiptPaymentMethodQuestionText(base));
    return;
  }
  setPendingReceiptConfirmation(from, { ...base, awaiting: "confirm" });
  logActivity(from, "receipt", `lido da imagem, pedindo confirmacao (${base.description})`);
  await sendText(from, receiptConfirmationSummaryText(from, base));
}

// Resposta a pergunta de categoria/forma de pagamento/confirmacao de um gasto
// lido de foto de comprovante. Cada etapa resolvida avanca pra proxima ate
// chegar em "confirm"; so registra de verdade com um "sim" claro no fim.
async function resolvePendingReceiptConfirmation(from: string, pending: PendingReceiptConfirmation, answerText: string) {
  if (pending.awaiting === "category") {
    const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
    const categoryName =
      findCategoryMentionedIn(from, answerText)?.name ?? (wordCount <= 3 ? answerText.trim() : await extractCategoryFromAnswer(answerText));
    const category = getOrCreateCategory(from, categoryName);
    const updated: PendingReceiptConfirmation = { ...pending, category: category.name };
    if (!updated.paymentMethod && !autoResolvePaymentMethod(from)) {
      updated.awaiting = "payment_method";
      setPendingReceiptConfirmation(from, updated);
      logActivity(from, "receipt", `categoria definida (${category.name}), forma de pagamento ainda desconhecida`);
      await sendText(from, receiptPaymentMethodQuestionText(updated));
      return;
    }
    updated.awaiting = "confirm";
    setPendingReceiptConfirmation(from, updated);
    logActivity(from, "receipt", `categoria definida (${category.name}), pedindo confirmacao`);
    await sendText(from, receiptConfirmationSummaryText(from, updated));
    return;
  }

  if (pending.awaiting === "payment_method") {
    const normalized = answerText.trim().toLowerCase();
    const skip = /^(n[aã]o sei|nao sei|sei l[aá]|deixa|pula|n[aã]o lembro)\b/.test(normalized);
    const updated: PendingReceiptConfirmation = { ...pending, paymentMethod: skip ? undefined : answerText.trim(), awaiting: "confirm" };
    setPendingReceiptConfirmation(from, updated);
    logActivity(from, "receipt", "forma de pagamento resolvida, pedindo confirmacao");
    await sendText(from, receiptConfirmationSummaryText(from, updated));
    return;
  }

  // awaiting === "confirm"
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

  if (yes) {
    clearPendingReceiptConfirmation(from);
    logActivity(from, "receipt", `confirmado (${pending.description})`);
    await finalizeReceiptExpense(from, pending);
    return;
  }
  if (no) {
    clearPendingReceiptConfirmation(from);
    logActivity(from, "receipt", "gasto lido da imagem nao confirmado");
    await sendText(from, "Beleza, não registrei nada.");
    return;
  }

  const correction = await extractReceiptCorrectionFromAnswer(answerText);
  if (!correction) {
    await sendText(from, receiptConfirmationSummaryText(from, pending, true));
    return;
  }
  const updated: PendingReceiptConfirmation = {
    ...pending,
    description: correction.description ?? pending.description,
    date: correction.date ?? pending.date,
  };
  if (correction.amount !== undefined) {
    updated.totalAmount = correction.amount;
  }
  if (correction.category) {
    const category = getOrCreateCategory(from, correction.category);
    updated.category = category.name;
  }
  if (correction.paymentMethod) {
    updated.paymentMethod = correction.paymentMethod;
  }
  setPendingReceiptConfirmation(from, updated);
  logActivity(from, "receipt", "ajustado antes de confirmar");
  await sendText(from, receiptConfirmationSummaryText(from, updated));
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
    if (pending.suggested_category) learnKeyword(from, pending.suggested_category, category.id);
    learnKeyword(from, pending.description, category.id);
    clearPendingCategorization(from, pending.id);

    const paymentMethod = autoResolvePaymentMethod(from, pending.suggested_payment_method);
    if (!paymentMethod) {
      // categoria resolvida, mas a forma de pagamento ficou ambigua -- pergunta
      // ela agora (com a oferta de padrao junto) ANTES de perguntar a proxima
      // categoria da fila, pra nao ter duas perguntas de tipos diferentes no ar
      // ao mesmo tempo (a proxima categoria so e perguntada depois que essa
      // forma de pagamento for resolvida, ver resolvePendingExpensePaymentMethod).
      const isHead = addPendingExpensePaymentMethod(from, {
        amount: pending.amount,
        description: pending.description,
        date: pending.date,
        categoryId: category.id,
        categoryName: category.name,
      });
      logActivity(
        from,
        "expense",
        `categoria definida (${category.name}) manualmente, forma de pagamento pendente: R$${pending.amount.toFixed(2)} — ${pending.description}`
      );
      if (isHead) await sendText(from, paymentMethodQuestionText(from, pending.amount, pending.description));
      return;
    }

    const { budgetAlert } = recordSimpleExpense(from, {
      amount: pending.amount,
      description: pending.description,
      date: pending.date,
      categoryId: category.id,
      categoryName: category.name,
      paymentMethod,
      logNote: "categorizado manualmente",
    });
    await sendText(
      from,
      `✅ Categorizado como "${category.name}". ${formatExpenseConfirmation({
        amount: pending.amount,
        description: pending.description,
        categoryName: category.name,
        date: pending.date,
        paymentMethodName: paymentMethod.name,
      })}${budgetAlert}`
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

// Resposta a "qual foi a forma de pagamento?" (ver paymentMethodQuestionText)
// -- valor/descricao/categoria ja resolvidos, so faltava isso. A resposta
// tambem serve como consentimento pra deixar essa forma como padrao (a
// pergunta ja avisa isso na mesma mensagem), entao sempre marca como padrao
// ao resolver aqui.
// Finaliza um gasto que estava esperando forma de pagamento (respondida ou
// resolvida sozinha por um padrao recem-definido) e manda a confirmacao
// padrao. Depois, se tinha mais algum gasto na fila esperando forma de
// pagamento tambem (ex: lote que desistiu, ver tryCreateExpenseBatch), tenta
// resolver ele sozinho com o padrao que acabou de ficar definido -- so
// pergunta de novo se, por algum motivo, ainda ficar ambiguo.
async function finalizePendingExpensePayment(from: string, pending: PendingExpensePaymentMethod, paymentMethod: { id: number; name: string }, extraNote?: string) {
  const { budgetAlert } = recordSimpleExpense(from, {
    amount: pending.amount,
    description: pending.description,
    date: pending.date,
    categoryId: pending.categoryId,
    categoryName: pending.categoryName,
    paymentMethod,
  });
  await sendText(
    from,
    `✅ Gasto registrado: ${formatExpenseConfirmation({
      amount: pending.amount,
      description: pending.description,
      categoryName: pending.categoryName,
      date: pending.date,
      paymentMethodName: paymentMethod.name,
    })}${budgetAlert}${extraNote ?? ""}`
  );

  const nextPayment = getNextPendingExpensePaymentMethod(from);
  if (nextPayment) {
    const nextMethod = autoResolvePaymentMethod(from);
    if (nextMethod) {
      clearHeadPendingExpensePaymentMethod(from);
      await finalizePendingExpensePayment(from, nextPayment, nextMethod);
    } else {
      await sendText(from, paymentMethodQuestionText(from, nextPayment.amount, nextPayment.description));
    }
  }

  // se tinha categorizacao pendente esperando (ver resolvePendingCategorization),
  // so pergunta agora que a forma de pagamento anterior ja foi resolvida
  const next = getNextPendingCategorization(from);
  if (next) await askForCategory(from, next.amount, next.description);
}

async function resolvePendingExpensePaymentMethod(from: string, pending: PendingExpensePaymentMethod, answerText: string) {
  try {
    const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
    const methodName = wordCount <= 3 ? answerText.trim() : (await extractPaymentMethodAnswer(answerText)).paymentMethod;
    const paymentMethod = getOrCreatePaymentMethod(from, methodName);
    // a pergunta ja avisa, na mesma mensagem, que a resposta vira a forma
    // padrao pras proximas vezes -- entao qualquer resposta aqui conta como
    // esse consentimento, sem precisar de uma segunda confirmacao so pra isso.
    setDefaultPaymentMethod(from, paymentMethod.id);
    clearHeadPendingExpensePaymentMethod(from);
    await finalizePendingExpensePayment(
      from,
      pending,
      paymentMethod,
      `\n\nDeixei "${paymentMethod.name}" como sua forma de pagamento padrão pras próximas vezes.`
    );
  } catch (err) {
    console.error("Erro ao resolver forma de pagamento pendente:", err);
    logActivity(from, "error", err instanceof Error ? err.message : String(err));
    await sendText(from, "Deu erro tentando salvar a forma de pagamento. Tenta me responder de novo.");
  }
}

// Passaram 30s sem resposta a "qual foi a forma de pagamento?" -- em vez de
// deixar essa pergunta pendente pra sempre (o que travaria toda mensagem
// futura desse numero, mesmo problema que motivou o TTL da fila de
// categorizacao), considera as informacoes ja exibidas como aceitas: registra
// o gasto sem forma de pagamento definida (pedido explicito do usuario) e
// avisa, pra poder corrigir depois se quiser.
const PENDING_PAYMENT_METHOD_TTL_MS = 30 * 1000;

function isPendingExpensePaymentMethodExpired(pending: PendingExpensePaymentMethod): boolean {
  return Date.now() - pending.createdAt > PENDING_PAYMENT_METHOD_TTL_MS;
}

async function finalizePendingExpensePaymentMethodByTimeout(from: string, pending: PendingExpensePaymentMethod) {
  try {
    clearHeadPendingExpensePaymentMethod(from);
    const { budgetAlert } = recordSimpleExpense(from, {
      amount: pending.amount,
      description: pending.description,
      date: pending.date,
      categoryId: pending.categoryId,
      categoryName: pending.categoryName,
      paymentMethod: null,
      logNote: "sem resposta a tempo pra forma de pagamento, registrado sem definir",
    });
    await sendText(
      from,
      `⏱️ Não recebi a forma de pagamento a tempo, então registrei assim mesmo: ${formatExpenseConfirmation({
        amount: pending.amount,
        description: pending.description,
        categoryName: pending.categoryName,
        date: pending.date,
        paymentMethodName: null,
      })}${budgetAlert}\n\nSe quiser, me diga qual foi que eu corrijo.`
    );

    const nextPayment = getNextPendingExpensePaymentMethod(from);
    if (nextPayment) await sendText(from, paymentMethodQuestionText(from, nextPayment.amount, nextPayment.description));

    const next = getNextPendingCategorization(from);
    if (next) await askForCategory(from, next.amount, next.description);
  } catch (err) {
    console.error("Erro ao finalizar forma de pagamento pendente por timeout:", err);
    logActivity(from, "error", err instanceof Error ? err.message : String(err));
    clearHeadPendingExpensePaymentMethod(from);
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

  const total = items.reduce((sum, i) => sum + i.amount, 0);
  return `🧾 Gastos — ${label}\n\n${sections.join("\n\n")}\n\n💰 Total: R$${total.toFixed(2)}\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45" ou "o 2 foi no pix".`;
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
  setLastShownExpenses(from, items.map((item) => item.id), range.label);
  logActivity(from, "list_expenses", `${items.length} gasto(s) em ${range.label} (detalhado)`);
  await sendText(from, buildGroupedExpenseListText(items, range.label));
}

// resposta a "confirma que quer cancelar o evento X?" -- so exclui de verdade
// com um "sim" claro; resposta ambigua pergunta de novo em vez de assumir
async function resolveEventDeletionConfirmation(from: string, pending: { eventId: number; title: string }, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

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

// resposta a "confirma que quer apagar o lembrete X?" -- mesma ideia de
// resolveEventDeletionConfirmation, pra lembrete.
async function resolveReminderDeletionConfirmation(from: string, pending: { reminderId: number; message: string }, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — quer mesmo apagar o lembrete "${pending.message}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingReminderDeletion(from);
  if (no) {
    logActivity(from, "delete_reminder", `cancelamento de "${pending.message}" nao confirmado`);
    await sendText(from, `Beleza, não mexi em nada — o lembrete "${pending.message}" continua ativo.`);
    return;
  }

  const fullReminder = getReminderById(from, pending.reminderId);
  deleteReminder(from, pending.reminderId);
  if (fullReminder) {
    setPendingUndo(from, {
      kind: "recreate_reminder",
      params: { toNumber: from, message: fullReminder.message, dueAt: fullReminder.due_at },
      description: fullReminder.message,
    });
  }
  logActivity(from, "delete_reminder", `confirmado: removido "${pending.message}"`);
  await sendText(from, `🗑️ Lembrete "${pending.message}" removido.`);
}

// resposta a "quer que eu crie como evento ou te explico como usar a agenda?"
// -- lembrete pedido com "avise X min antes", que lembrete simples nao suporta.
async function resolveReminderAdvanceChoice(
  from: string,
  pending: { message: string; dueAt: string; advanceMinutes: number },
  answerText: string
) {
  const normalized = answerText.trim().toLowerCase();
  const wantsEvent = /\b(evento|agenda|cria|criar|marca|marcar|pode|sim|isso|beleza)\b/.test(normalized);
  const wantsExplanation = /\b(explic|como|d[uú]vida|ensina)\b/.test(normalized);
  const cancels = /^(n[aã]o|nao quero|cancela|deixa|esquece)\b/.test(normalized) && !wantsEvent;

  if (cancels) {
    clearPendingReminderAdvanceChoice(from);
    logActivity(from, "reminder", `pedido de aviso antecipado pra "${pending.message}" cancelado`);
    await sendText(from, "Beleza, não criei nada.");
    return;
  }

  if (wantsExplanation && !wantsEvent) {
    clearPendingReminderAdvanceChoice(from);
    logActivity(from, "reminder", `explicou como usar a agenda pra aviso antecipado ("${pending.message}")`);
    await sendText(
      from,
      `📅 Pra ser avisado com antecedência, marca como um EVENTO na agenda em vez de lembrete — o evento já tem esse recurso pronto.\n\nExemplo: "marca ${pending.message} dia ${formatDateOnly(pending.dueAt)} às ${pending.dueAt.slice(11, 16)}, me avisa ${pending.advanceMinutes} minutos antes".\n\nSe preferir, é só responder "cria como evento" agora que eu já crio com esses dados.`
    );
    return;
  }

  if (wantsEvent) {
    clearPendingReminderAdvanceChoice(from);
    await createEventAndNotify(from, { title: pending.message, start: pending.dueAt, reminderMinutes: pending.advanceMinutes });
    return;
  }

  await sendText(
    from,
    `Não entendi — quer que eu crie "${pending.message}" como um EVENTO na agenda (aviso ${pending.advanceMinutes} min antes de verdade), ou prefere que eu explique como fazer isso você mesmo? Responde "evento" ou "explica".`
  );
}

// resposta a "confirma que quer mudar N gastos pra categoria X?" -- so aplica de
// verdade com um "sim" claro; resposta ambigua pergunta de novo em vez de assumir
async function resolveBulkRecategorizeConfirmation(from: string, pending: PendingBulkRecategorize, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

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
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

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

// resposta a "confirma que quer apagar o gasto X?" -- so apaga com um "sim"
// claro; "desfaz isso" recria o gasto com os mesmos dados
async function performDeleteExpense(
  from: string,
  expense: { id: number; amount: number; description: string; date: string; category_id: number | null; payment_method_id: number | null }
) {
  // compra parcelada: apagar UMA parcela apaga TODAS as do mesmo grupo
  const group = findInstallmentGroup(from, expense.id);
  if (group) {
    const total = group.reduce((sum, e) => sum + e.amount, 0);
    const baseName = expense.description.replace(/ \(parcela \d+\/\d+\)$/, "");
    withTransaction(() => {
      for (const parcela of group) deleteExpense(from, parcela.id);
    });
    setPendingUndo(from, {
      kind: "recreate_expenses",
      items: group.map((e) => ({
        fromNumber: from,
        amount: e.amount,
        description: e.description,
        categoryId: e.category_id,
        paymentMethodId: e.payment_method_id,
        date: e.date,
      })),
      description: `${baseName} (${group.length} parcelas)`,
    });
    logActivity(from, "delete_expense", `compra parcelada apagada: ${baseName}, ${group.length} parcela(s), R$${total.toFixed(2)}`);
    await sendText(
      from,
      `🗑️ Compra parcelada apagada: "${baseName}" — as ${group.length} parcelas (total R$${total.toFixed(2)}) foram removidas. Se foi sem querer, é só dizer "desfaz isso".`
    );
    return;
  }

  const removed = deleteExpense(from, expense.id);
  if (!removed) {
    await sendText(from, "Esse gasto já não existe mais.");
    return;
  }
  setPendingUndo(from, {
    kind: "recreate_expense",
    params: {
      fromNumber: from,
      amount: expense.amount,
      description: expense.description,
      categoryId: expense.category_id,
      paymentMethodId: expense.payment_method_id,
      date: expense.date,
    },
    description: `R$${expense.amount.toFixed(2)} — ${expense.description}`,
  });
  logActivity(from, "delete_expense", `apagado: R$${expense.amount.toFixed(2)} — ${expense.description}`);
  await sendText(from, `🗑️ Gasto apagado: R$${expense.amount.toFixed(2)} — ${expense.description}. Se foi sem querer, é só dizer "desfaz isso".`);
}

// mostra os ultimos gastos numerados pra o usuario escolher qual apagar
async function offerDeleteChoices(from: string) {
  const items = getRecentExpensesList(from, 8);
  if (!items.length) {
    await sendText(from, "Você não tem nenhum gasto registrado pra apagar.");
    return;
  }
  setPendingDeleteExpense(from, {
    expenseId: 0,
    amount: 0,
    description: "",
    date: "",
    categoryId: null,
    categoryName: null,
    paymentMethodId: null,
    choices: items.map((i) => i.id),
  });
  const lines = items.map((item, idx) => `${idx + 1}. R$${item.amount.toFixed(2)} — ${item.description} (${item.category ?? "sem categoria"}) — ${formatDateOnly(item.date)}`);
  await sendText(from, `Qual desses você quer apagar? Responde com o número (ou "cancelar").\n\n${lines.join("\n")}`);
}

async function resolveDeleteExpenseConfirmation(from: string, pending: PendingDeleteExpense, answerText: string) {
  const normalized = answerText.trim().toLowerCase();

  if (pending.choices) {
    const pick = Number(normalized.replace(/[^0-9]/g, ""));
    const id = /^\D*\d+\D*$/.test(normalized) ? pending.choices[pick - 1] : undefined;
    if (id) {
      clearPendingDeleteExpense(from);
      const expense = getExpenseById(from, id);
      if (!expense) {
        await sendText(from, "Esse gasto já não existe mais.");
        return;
      }
      await performDeleteExpense(from, expense);
      return;
    }
    if (/^(n[aã]o|n|deixa|espera)\b/.test(normalized)) {
      clearPendingDeleteExpense(from);
      await sendText(from, "Beleza, não apaguei nada.");
      return;
    }
    await sendText(from, `Não entendi — responde com o número do gasto (1 a ${pending.choices.length}), ou "cancelar".`);
    return;
  }

  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer apagar o gasto "${pending.description}" (R$${pending.amount.toFixed(2)})? Responde "sim" ou "não".`);
    return;
  }

  clearPendingDeleteExpense(from);
  if (no) {
    logActivity(from, "delete_expense", `apagar #${pending.expenseId} nao confirmado`);
    if (pending.offerChoices) {
      // nao disse qual gasto e o mais recente nao era esse: mostra os ultimos pra escolher
      await offerDeleteChoices(from);
      return;
    }
    await sendText(from, "Beleza, não apaguei nada.");
    return;
  }

  const expense = getExpenseById(from, pending.expenseId);
  if (!expense) {
    await sendText(from, "Esse gasto já não existe mais.");
    return;
  }
  await performDeleteExpense(from, expense);
}

// resposta a "confirma que quer apagar a categoria X?" -- so apaga de verdade
// com um "sim" claro. Os gastos ficam sem categoria (nunca sao apagados) e o
// "desfaz isso" recria a categoria e devolve eles (mesmo undo do merge).
async function resolveDeleteCategoryConfirmation(from: string, pending: PendingDeleteCategory, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer apagar a categoria "${pending.categoryName}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingDeleteCategory(from);
  if (no) {
    logActivity(from, "delete_category", `"${pending.categoryName}" nao confirmado`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  deleteCategory(from, pending.categoryId);
  setPendingUndo(from, {
    kind: "undo_merge_categories",
    expenseIds: pending.expenseIds,
    sourceCategoryName: pending.categoryName,
    description: `categoria "${pending.categoryName}" apagada`,
  });
  logActivity(from, "delete_category", `confirmado: "${pending.categoryName}" apagada (${pending.expenseIds.length} gasto(s) sem categoria)`);
  await sendText(
    from,
    `✅ Categoria "${pending.categoryName}" apagada.${pending.expenseIds.length ? ` ${pending.expenseIds.length} gasto(s) dela ficaram sem categoria.` : ""} Se foi sem querer, é só dizer "desfaz isso".`
  );
}

// ---------------------------------------------------------------------------
// Confirmacao de edicao: previa "antes -> depois" com opcoes 1/2/3.
// A leitura da resposta (sim/nao/corrigir/texto livre) vem toda de
// src/confirmation/classify.ts -- nenhuma regex yes/no aqui.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Escolha de alvo: quando o pedido cita um item pelo nome e ha mais de um
// candidato, o bot manda uma lista numerada e o usuario responde so o numero --
// o fluxo continua de onde parou (handleInterpretation com o id ja resolvido).
// ---------------------------------------------------------------------------

function targetActionVerb(action: Interpretation): string {
  switch (action.type) {
    case "edit_event":
    case "edit_reminder":
      return action.new_date || action.new_time ? "remarcar" : "editar";
    case "delete_event":
      return "cancelar";
    case "delete_reminder":
    case "delete_expense":
    case "delete_income":
      return "apagar";
    case "snooze_reminder":
      return "adiar";
    case "add_event_reminder":
      return "adicionar o aviso";
    case "remove_event_reminder":
      return "remover o aviso";
    default:
      return "editar";
  }
}

// "editar" -> tipo, sem nada cadastrado
const NOTHING_TO_EDIT_TEXT: Record<TargetKind, string> = {
  expense: "Você ainda não tem nenhum gasto registrado pra editar.",
  event: "Você não tem nenhum evento futuro pra editar.",
  reminder: "Você não tem nenhum lembrete pendente pra editar.",
  recurring: "Você não tem nenhum gasto fixo pra editar.",
  income: "Você ainda não tem nenhuma entrada registrada pra editar.",
  reminder_sent: SNOOZE_NOT_FOUND_TEXT,
};

function targetNotFoundText(action: Interpretation, kind: TargetKind, query?: string): string {
  if (kind === "event") return query ? `Não encontrei nenhum evento futuro parecido com "${query}".` : NOTHING_TO_EDIT_TEXT.event;
  if (kind === "reminder") return query ? `Não encontrei nenhum lembrete parecido com "${query}".` : NOTHING_TO_EDIT_TEXT.reminder;
  if (kind === "recurring") return query ? `Não achei nenhum gasto fixo parecido com "${query}".` : NOTHING_TO_EDIT_TEXT.recurring;
  if (kind === "reminder_sent") return SNOOZE_NOT_FOUND_TEXT;
  if (kind === "income") {
    if (query) return `Não achei nenhuma entrada parecida com "${query}".`;
    return action.type === "delete_income" ? "Você ainda não tem nenhuma entrada registrada pra apagar." : NOTHING_TO_EDIT_TEXT.income;
  }
  const similar = query ? ` parecido com "${query}"` : "";
  if (action.type === "delete_expense") return `Não achei nenhum gasto${query ? similar : " registrado"} pra apagar.`;
  if (action.type === "correct_category") return `Não achei nenhum gasto recente${similar} pra corrigir.`;
  return `Não achei nenhum gasto recente${similar} pra editar.`;
}

interface TargetSearch {
  ids: number[];
  lines: string[];
  total: number;
}

// candidatos que batem com o texto (no maximo MAX_TARGET_CANDIDATES mostrados;
// "total" diz quantos bateram de verdade, pra avisar que tem mais)
function searchTargets(from: string, kind: TargetKind, query: string): TargetSearch {
  let entries: { id: number; line: string }[];
  if (kind === "event") {
    entries = findUpcomingEvents(from, query).map((e) => ({ id: e.id, line: eventLine(e) }));
  } else if (kind === "reminder") {
    entries = findPendingRemindersByText(from, query).map((r) => ({ id: r.id, line: reminderLine(r) }));
  } else if (kind === "recurring") {
    entries = findActiveRecurringCandidates(from, query).map((r) => ({ id: r.id, line: recurringLine(r) }));
  } else if (kind === "income") {
    entries = findIncomeCandidates(from, query).map((i) => ({ id: i.id, line: incomeLine(i) }));
  } else if (kind === "reminder_sent") {
    entries = findRecentSentReminders(from, query, 24).map((r) => ({ id: r.id, line: reminderLine(r) }));
  } else {
    entries = findExpenseCandidates(from, query).map((e) => ({
      id: e.id,
      line: expenseLine(e, e.payment_method_id !== null ? getPaymentMethodById(from, e.payment_method_id)?.name : null),
    }));
  }
  const shown = entries.slice(0, MAX_TARGET_CANDIDATES);
  return { ids: shown.map((e) => e.id), lines: shown.map((e) => e.line), total: entries.length };
}

// os itens de um tipo, sem busca (o usuario escolheu "editar" -> tipo)
function browseTargets(from: string, kind: TargetKind): TargetSearch {
  let entries: { id: number; line: string }[];
  if (kind === "event") entries = listUpcomingEvents(from, 90).map((e) => ({ id: e.id, line: eventLine(e) }));
  else if (kind === "reminder") entries = getRemindersWithinDays(from, 365).map((r) => ({ id: r.id, line: reminderLine(r) }));
  else if (kind === "recurring") entries = listRecurringExpenses(from).map((r) => ({ id: r.id, line: recurringLine(r) }));
  else if (kind === "income") entries = getRecentIncomesList(from, MAX_TARGET_CANDIDATES).map((i) => ({ id: i.id, line: incomeLine(i) }));
  else if (kind === "reminder_sent") entries = findRecentSentReminders(from, undefined, 2).map((r) => ({ id: r.id, line: reminderLine(r) }));
  else entries = getRecentExpensesList(from, MAX_TARGET_CANDIDATES).map((i) => ({ id: i.id, line: expenseLine(i, i.payment_method) }));
  const shown = entries.slice(0, MAX_TARGET_CANDIDATES);
  return { ids: shown.map((e) => e.id), lines: shown.map((e) => e.line), total: entries.length };
}

// acao "vazia" de edicao de cada tipo: ao escolher o item, cai no menu de campos
function emptyEditAction(kind: TargetKind): Interpretation {
  if (kind === "event") return { type: "edit_event", query: "" };
  if (kind === "reminder") return { type: "edit_reminder", query: "" };
  if (kind === "recurring") return { type: "edit_recurring_expense", query: "" };
  if (kind === "income") return { type: "edit_income" };
  return { type: "edit_expense" };
}

// "editar" -> tipo: lista numerada dos itens daquele tipo; o numero escolhido abre o menu de campos
async function offerBrowseList(from: string, kind: TargetKind) {
  const found = browseTargets(from, kind);
  if (found.total === 0) {
    await sendText(from, NOTHING_TO_EDIT_TEXT[kind]);
    return;
  }
  // continua valendo "muda o valor do 2 pra 45" em cima dessa lista (RN10)
  if (kind === "expense") setLastShownExpenses(from, found.ids, "últimos gastos");
  await sendTargetList(from, kind, emptyEditAction(kind), found, { type: "browse" });
}

function targetExists(from: string, kind: TargetKind, id: number): boolean {
  if (kind === "event") return Boolean(getEventById(from, id));
  if (kind === "reminder") return Boolean(getReminderById(from, id));
  if (kind === "recurring") return Boolean(getRecurringExpenseById(from, id)?.active);
  if (kind === "income") return Boolean(getIncomeById(from, id));
  if (kind === "reminder_sent") return Boolean(getReminderById(from, id));
  return Boolean(getExpenseById(from, id));
}

async function sendTargetList(
  from: string,
  kind: TargetKind,
  action: Interpretation,
  found: TargetSearch,
  header: TargetListHeader
) {
  setPendingTargetChoice(from, { kind, action, candidateIds: found.ids });
  logActivity(from, action.type, `${found.total} candidato(s), lista numerada enviada`);
  await sendText(from, formatTargetList({ kind, header, verb: targetActionVerb(action), lines: found.lines, total: found.total }));
}

// Ponto de entrada unico dos 9 fluxos: devolve o id do item-alvo, ou null quando
// ja respondeu ao usuario (nao achou nada, ou mandou a lista pra ele escolher --
// nesse caso o fluxo continua quando ele responder, via handleInterpretation com
// o id resolvido). "resolvedId" vem de uma escolha ja feita: so confere que o
// item ainda existe (RN05).
async function chooseTarget(
  from: string,
  kind: TargetKind,
  action: Interpretation,
  query: string | undefined,
  resolvedId?: number
): Promise<number | null> {
  if (resolvedId !== undefined) {
    if (!targetExists(from, kind, resolvedId)) {
      logActivity(from, action.type, "item escolhido nao existe mais");
      await sendText(from, TARGET_GONE_TEXT);
      return null;
    }
    return resolvedId;
  }

  // gasto sem texto de busca ("muda o ultimo gasto..."): usa o mais recente, sem lista (RN08)
  if (!query && (kind === "expense" || kind === "income")) {
    const last = kind === "income" ? findRecentIncome(from) : findRecentExpense(from);
    if (!last) {
      logActivity(from, action.type, "nenhum gasto encontrado para \"mais recente\"");
      await sendText(from, targetNotFoundText(action, kind));
      return null;
    }
    return last.id;
  }
  // os outros tipos sem texto de busca ("edita o gasto fixo"): lista os itens do tipo
  if (!query) {
    const all = browseTargets(from, kind);
    if (all.total === 0) {
      logActivity(from, action.type, "nenhum item cadastrado");
      await sendText(from, targetNotFoundText(action, kind));
      return null;
    }
    if (all.total === 1) return all.ids[0];
    await sendTargetList(from, kind, action, all, { type: "browse" });
    return null;
  }

  const found = searchTargets(from, kind, query);
  if (found.total === 0) {
    logActivity(from, action.type, `nenhum item encontrado para "${query}"`);
    await sendText(from, targetNotFoundText(action, kind, query));
    return null;
  }
  if (found.total === 1) return found.ids[0];
  await sendTargetList(from, kind, action, found, { type: "found", query });
  return null;
}

// RN07: "edita o 2" com a lista de gastos ja expirada -- nao reaproveita o numero
// contra outra lista; oferece os ultimos gastos e continua a acao escolhida
async function offerRecentExpensesForExpiredList(from: string, action: Interpretation) {
  const items = getRecentExpensesList(from, MAX_TARGET_CANDIDATES);
  if (!items.length) {
    await sendText(from, targetNotFoundText(action, "expense"));
    return;
  }
  // o numero digitado antes e descartado: a acao continua so com o gasto escolhido agora
  const withoutListRef = { ...action, list_ref: undefined } as Interpretation;
  await sendTargetList(
    from,
    "expense",
    withoutListRef,
    {
      ids: items.map((i) => i.id),
      lines: items.map((i) => expenseLine(i, i.payment_method)),
      total: items.length,
    },
    { type: "expired" }
  );
}

async function resolveTargetChoiceReply(from: string, pending: PendingTargetChoice, answerText: string) {
  const actionType = pending.action.type;
  const reply = interpretTargetReply(answerText, pending.candidateIds.length);

  if (reply.type === "cancel") {
    clearPendingTargetChoice(from);
    logActivity(from, actionType, "escolha de item cancelada");
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply.type === "multiple") {
    logActivity(from, actionType, "varios numeros na escolha de item -- pediu um por vez");
    await sendText(from, targetMultipleText(pending.candidateIds.length, actionType.startsWith("edit_")));
    return;
  }
  if (reply.type === "invalid") {
    logActivity(from, actionType, "resposta nao entendida na escolha de item");
    await sendText(from, targetNotUnderstoodText(pending.candidateIds.length));
    return;
  }
  if (reply.type === "pick") {
    clearPendingTargetChoice(from);
    const id = pending.candidateIds[reply.index];
    logActivity(from, actionType, `escolheu o item ${reply.index + 1} (#${id})`);
    await handleInterpretation(from, pending.action, id);
    return;
  }

  // refino: nova busca do mesmo tipo e da mesma acao, trocando so o texto de busca
  const refinedAction = { ...pending.action, query: reply.query } as Interpretation;
  const found = searchTargets(from, pending.kind, reply.query);
  if (found.total === 0) {
    logActivity(from, actionType, `refino "${reply.query}" nao achou nada`);
    await sendText(from, targetNotUnderstoodText(pending.candidateIds.length));
    return;
  }
  if (found.total === 1) {
    clearPendingTargetChoice(from);
    logActivity(from, actionType, `refino "${reply.query}" achou 1 item (#${found.ids[0]})`);
    await handleInterpretation(from, refinedAction, found.ids[0]);
    return;
  }
  logActivity(from, actionType, `refino "${reply.query}" ainda tem ${found.total} candidatos`);
  await sendTargetList(from, pending.kind, refinedAction, found, { type: "refined", query: reply.query });
}

// confirmacao de edicao ativa pra esse numero (se houver): rotulo pra mensagens,
// se esta em "aguardando correcao" e que tipo de valor a correcao espera
function describeActiveEditConfirmation(from: string): { label: string; awaitingCorrection: boolean; kind: CorrectionKind } | null {
  const menu = getPendingFieldMenu(from);
  if (menu) return { label: menu.label, awaitingCorrection: menu.stage === "ask_value", kind: "text" };
  const expense = getPendingEditExpense(from);
  if (expense) return { label: expenseEditLabel(expense.items), awaitingCorrection: expense.awaitingCorrection, kind: expenseEditKind(expense) };
  const income = getPendingEditIncome(from);
  if (income) return { label: income.description, awaitingCorrection: income.awaitingCorrection, kind: incomeEditKind(income) };
  const incomeDeletion = getPendingDeleteIncome(from);
  if (incomeDeletion) return { label: incomeDeletion.snapshot.description, awaitingCorrection: false, kind: "text" };
  const event = getPendingEditEvent(from);
  if (event) return { label: event.title, awaitingCorrection: event.awaitingCorrection, kind: eventEditKind(event) };
  const reminder = getPendingEditReminder(from);
  if (reminder) return { label: reminder.message, awaitingCorrection: reminder.awaitingCorrection, kind: reminderCorrectionKind(reminder) };
  const recurring = getPendingEditRecurring(from);
  if (recurring) {
    return { label: recurring.previous.description, awaitingCorrection: recurring.awaitingCorrection, kind: recurringCorrectionTarget(recurring).kind };
  }
  return null;
}

// RN07: no maximo uma confirmacao de edicao ativa por numero
function clearEditConfirmations(from: string) {
  clearPendingFieldMenu(from);
  clearPendingEditExpense(from);
  clearPendingEditIncome(from);
  clearPendingDeleteIncome(from);
  clearPendingEditEvent(from);
  clearPendingEditReminder(from);
  clearPendingEditRecurring(from);
}

type CorrectionValue =
  | { kind: "amount"; amount: number }
  | { kind: "date"; date: string }
  | { kind: "datetime"; newDate?: string; newTime?: string }
  | { kind: "day"; day: number }
  | { kind: "lead"; minutes: number }
  | { kind: "endtime"; spec: EndSpec }
  | { kind: "location"; location: string | null }
  | { kind: "text"; text: string };

// interpreta o texto como o tipo de valor pedido; devolve o motivo se nao der
async function interpretCorrection(
  kind: CorrectionKind,
  text: string,
  context: { startIso?: string } = {}
): Promise<{ value: CorrectionValue } | { error: string }> {
  const trimmed = text.trim();
  if (kind === "endtime") {
    const resolved = context.startIso ? resolveEndSpec(trimmed, context.startIso) : ({ ok: false, error: END_NOT_UNDERSTOOD_TEXT } as const);
    return resolved.ok ? { value: { kind, spec: resolved.spec } } : { error: resolved.error };
  }
  if (kind === "location") {
    const parsed = parseLocationAnswer(trimmed);
    return parsed.ok ? { value: { kind, location: parsed.location } } : { error: parsed.error };
  }
  if (kind === "amount") {
    const parsed = parseBrazilianAmountDetailed(trimmed);
    if (parsed.ok) return { value: { kind, amount: parsed.value } };
    return { error: parsed.reason === "not_positive" ? "O valor precisa ser maior que R$ 0,00." : `Não entendi o valor "${trimmed}".` };
  }
  if (kind === "day") {
    const day = parseDayOfMonthAnswer(trimmed);
    return day === null ? { error: "O dia do mês precisa ser de 1 a 31." } : { value: { kind, day } };
  }
  if (kind === "lead") {
    const minutes = parseLeadTimeMinutes(trimmed);
    return minutes === null ? { error: `Não entendi a antecedência "${trimmed}".` } : { value: { kind, minutes } };
  }
  if (kind === "text") {
    return trimmed ? { value: { kind, text: trimmed } } : { error: "Não recebi nada." };
  }
  const extracted = await extractDateTimeFromAnswer(trimmed);
  if (kind === "date") {
    return extracted?.newDate ? { value: { kind, date: extracted.newDate } } : { error: `Não entendi a data "${trimmed}".` };
  }
  return extracted && (extracted.newDate || extracted.newTime)
    ? { value: { kind, newDate: extracted.newDate, newTime: extracted.newTime } }
    : { error: `Não entendi a data e hora "${trimmed}".` };
}

// RN04: texto livre so vira nova previa quando o campo pendente e valor ou
// data/hora (ou dia do mes); campo de texto NUNCA recebe o texto livre
function acceptsFreeText(kind: CorrectionKind): boolean {
  return kind === "amount" || kind === "date" || kind === "datetime" || kind === "day" || kind === "endtime";
}

// ---------------------------------------------------------------------------
// Menu guiado de campos: depois de escolher o item, o usuario escolhe o(s)
// campo(s) a mudar e responde uma pergunta curta por campo; no fim cai na
// previa 1/2/3 normal (handleInterpretation com o id do item ja resolvido).
// Nada e gravado nem criado antes do "1" da previa.
// ---------------------------------------------------------------------------

const MENU_ACTIVITY: Record<MenuKind, string> = {
  income: "edit_income",
  expense: "edit_expense",
  event: "edit_event",
  reminder: "edit_reminder",
  recurring: "edit_recurring_expense",
};

// cabecalho do item (1a linha do menu); null quando o item nao existe mais
function fieldMenuHeader(from: string, kind: MenuKind, itemId: number): { header: string; label: string } | null {
  if (kind === "expense") {
    const expense = getExpenseById(from, itemId);
    return expense ? { header: headerFor(from, expenseParamsOf(expense)), label: expense.description } : null;
  }
  if (kind === "income") {
    const income = getIncomeById(from, itemId);
    return income ? { header: incomeHeader(incomeParamsOf(income)), label: income.description } : null;
  }
  if (kind === "event") {
    const event = getEventById(from, itemId);
    return event ? { header: eventHeader(event), label: event.title } : null;
  }
  if (kind === "reminder") {
    const reminder = getReminderById(from, itemId);
    return reminder ? { header: reminderLine(reminder), label: reminder.message } : null;
  }
  const recurring = getRecurringExpenseById(from, itemId);
  if (!recurring || !recurring.active) return null;
  return {
    header: recurringHeader({ description: recurring.description, amount: recurring.amount, dayOfMonth: recurring.day_of_month }),
    label: recurring.description,
  };
}

// opcoes numeradas da pergunta de categoria / forma de pagamento (ate 8 existentes)
function fieldChoices(from: string, def: FieldDef): string[] {
  if (def.question === "category") return listCategories(from).slice(0, MAX_CHOICE_OPTIONS).map((c) => c.name);
  if (def.question === "payment_method") return listPaymentMethods(from).slice(0, MAX_CHOICE_OPTIONS).map((m) => m.name);
  return [];
}

// RN08: um menu por numero; abrir outro limpa as confirmacoes de edicao e a escolha de alvo
async function openFieldMenu(from: string, kind: MenuKind, itemId: number) {
  const info = fieldMenuHeader(from, kind, itemId);
  if (!info) {
    await sendText(from, TARGET_GONE_TEXT);
    return;
  }
  clearEditConfirmations(from);
  clearPendingTargetChoice(from);
  setPendingFieldMenu(from, { kind, itemId, header: info.header, label: info.label, stage: "choose_fields", queue: [], step: 0, collected: {}, choices: [] });
  logActivity(from, MENU_ACTIVITY[kind], `menu de campos aberto: "${info.label}"`);
  await sendText(from, formatFieldMenu(info.header, kind));
}

// monta a acao de edicao equivalente as respostas e entrega pro fluxo normal (previa 1/2/3)
async function dispatchFieldMenuEdit(from: string, pending: PendingFieldMenu) {
  const c = pending.collected;
  const dateTime = c.datetime as DateTimeAnswer | undefined;
  let action: Interpretation;
  if (pending.kind === "income") {
    const changes = pending.queue.map((key) => {
      const value = c[key];
      return { field: key as IncomeEditField, value: key === "amount" ? String(value).replace(".", ",") : String(value) };
    });
    action = { type: "edit_income", changes };
  } else if (pending.kind === "expense") {
    const changes = pending.queue.map((key) => {
      const value = c[key];
      // valor em formato brasileiro ("45,9"), igual ao que o usuario digitaria
      return { field: key as ExpenseEditField, value: key === "amount" ? String(value).replace(".", ",") : String(value) };
    });
    action = { type: "edit_expense", changes };
  } else if (pending.kind === "event") {
    action = {
      type: "edit_event",
      query: "",
      new_title: c.title as string | undefined,
      new_date: dateTime?.newDate,
      new_time: dateTime?.newTime,
      new_reminder_minutes: c.lead as number | undefined,
      new_end_time: (c.end as EndSpec | undefined)?.endTime,
      new_duration_minutes: (c.end as EndSpec | undefined)?.durationMinutes,
      new_location: (c.location as LocationAnswer | undefined)?.location ?? undefined,
      clear_location: c.location !== undefined && (c.location as LocationAnswer).location === null ? true : undefined,
    };
  } else if (pending.kind === "reminder") {
    action = { type: "edit_reminder", query: "", new_message: c.message as string | undefined, new_date: dateTime?.newDate, new_time: dateTime?.newTime };
  } else {
    action = {
      type: "edit_recurring_expense",
      query: "",
      new_description: c.description as string | undefined,
      new_amount: c.amount as number | undefined,
      new_category: c.category as string | undefined,
      new_day_of_month: c.day as number | undefined,
      new_payment_method: c.payment_method as string | undefined,
    };
  }
  logActivity(from, MENU_ACTIVITY[pending.kind], `campos respondidos (${pending.queue.join(", ")}) -- indo pra previa`);
  await handleInterpretation(from, action, pending.itemId);
}

async function resolveFieldMenuReply(from: string, pending: PendingFieldMenu, answerText: string) {
  const activity = MENU_ACTIVITY[pending.kind];
  const fields = FIELD_REGISTRY[pending.kind];

  const cancel = async (why: string) => {
    clearPendingFieldMenu(from);
    logActivity(from, activity, `menu de campos cancelado ${why}: "${pending.label}"`);
    await sendText(from, "Beleza, não mexi em nada.");
  };

  // RN09: item sumiu no meio do caminho
  if (!fieldMenuHeader(from, pending.kind, pending.itemId)) {
    clearPendingFieldMenu(from);
    logActivity(from, activity, `menu de campos: "${pending.label}" nao existe mais`);
    await sendText(from, TARGET_GONE_TEXT);
    return;
  }

  if (pending.stage === "choose_fields") {
    const selection = parseFieldSelection(answerText, pending.kind);
    if (!selection.ok) {
      if (classifyConfirmationReply(answerText) === "cancel") {
        await cancel("na escolha de campos");
        return;
      }
      logActivity(from, activity, "menu de campos: selecao invalida");
      await sendText(from, FIELD_SELECTION_RETRY);
      return;
    }
    const first = fields.find((f) => f.key === selection.keys[0])!;
    const choices = fieldChoices(from, first);
    setPendingFieldMenu(from, { ...pending, stage: "ask_value", queue: selection.keys, step: 0, collected: {}, choices });
    logActivity(from, activity, `campos escolhidos: ${selection.keys.join(", ")}`);
    await sendText(from, formatFieldQuestion({ def: first, step: 1, total: selection.keys.length, options: choices }));
    return;
  }

  // ask_value: so a palavra "cancelar" cancela; "1", "3" e "nao" sao valores (RN04)
  if (isCancelWord(answerText) || normalizeReply(answerText) === "cancela") {
    await cancel("numa pergunta");
    return;
  }
  const def = fields.find((f) => f.key === pending.queue[pending.step])!;
  const params = { def, step: pending.step + 1, total: pending.queue.length, options: pending.choices };

  let raw = answerText.trim();
  if (isChoiceQuestion(def.question) && /^\d+$/.test(raw)) {
    const picked = pending.choices[Number(raw) - 1];
    if (picked) raw = picked;
  }
  // o termino do evento depende do inicio JA com a mudanca de dia/hora respondida antes (se houve)
  let startIso: string | undefined;
  if (pending.kind === "event") {
    const event = getEventById(from, pending.itemId);
    const dateTime = pending.collected.datetime as DateTimeAnswer | undefined;
    if (event) startIso = dateTime ? mergeDateTime(event.start, dateTime.newDate, dateTime.newTime) : event.start;
  }
  const answer = await validateFieldAnswer(def, raw, from, { startIso });
  if (!answer.ok) {
    logActivity(from, activity, `menu de campos: resposta invalida em ${def.label}`);
    await sendText(from, formatFieldRetry(answer.error, params));
    return;
  }

  const collected = { ...pending.collected, [def.key]: answer.value };
  if (pending.step + 1 < pending.queue.length) {
    const next = fields.find((f) => f.key === pending.queue[pending.step + 1])!;
    const choices = fieldChoices(from, next);
    setPendingFieldMenu(from, { ...pending, step: pending.step + 1, collected, choices });
    await sendText(from, formatFieldQuestion({ def: next, step: pending.step + 2, total: pending.queue.length, options: choices }));
    return;
  }
  clearPendingFieldMenu(from);
  await dispatchFieldMenuEdit(from, { ...pending, collected });
}

// ---- entradas (receitas) -----------------------------------------------------
// Espelha o fluxo dos gastos: lista numerada, edicao com previa 1/2/3 (um item,
// ate 3 campos), exclusao com "1 apagar / 3 cancelar" e desfazer dos dois.

const INCOME_FIELD_NOUN: Record<IncomeEditField, string> = { amount: "valor", description: "descrição", date: "data" };

function incomeParamsOf(income: IncomeRecord): IncomeParams {
  return { amount: income.amount, description: income.description, date: income.date };
}

function incomeChangedSince(current: IncomeRecord, previous: IncomeParams): boolean {
  return current.amount !== previous.amount || current.description !== previous.description || current.date !== previous.date;
}

// RN03(d): "edita o 2" com a lista de entradas expirada -- nao reaproveita o numero
// contra outra lista; oferece as 8 ultimas entradas e continua a acao escolhida
async function offerRecentIncomesForExpiredList(from: string, action: Interpretation) {
  const items = getRecentIncomesList(from, MAX_TARGET_CANDIDATES);
  if (!items.length) {
    await sendText(from, NOTHING_TO_EDIT_TEXT.income);
    return;
  }
  const withoutListRef = { ...action, list_ref: undefined } as Interpretation;
  await sendTargetList(from, "income", withoutListRef, { ids: items.map((i) => i.id), lines: items.map(incomeLine), total: items.length }, { type: "expired" });
}

// acha a entrada de um pedido de edicao/exclusao: numero da lista, texto (Card 2) ou "a ultima"
async function resolveIncomeTarget(
  from: string,
  interpretation: Extract<Interpretation, { type: "edit_income" | "delete_income" }>,
  resolvedTargetId?: number
): Promise<IncomeRecord | null> {
  if (resolvedTargetId !== undefined || !interpretation.list_ref) {
    const incomeId = await chooseTarget(from, "income", interpretation, interpretation.query, resolvedTargetId);
    return incomeId === null ? null : getIncomeById(from, incomeId);
  }
  const ids = getLastShownIncomes(from);
  if (ids === null) {
    await offerRecentIncomesForExpiredList(from, interpretation);
    return null;
  }
  const id = ids[interpretation.list_ref - 1];
  const income = id ? getIncomeById(from, id) : null;
  if (!income) {
    logActivity(from, interpretation.type, `referencia "${interpretation.list_ref}" sem lista valida`);
    await sendText(from, `Não sei a que entrada o número "${interpretation.list_ref}" se refere. Me pede a lista de novo, ex: "minhas entradas".`);
    return null;
  }
  return income;
}

// monta a previa (valida tudo) e so entao guarda a pendencia e pergunta 1/2/3
async function startIncomeEdit(from: string, income: IncomeRecord, rawChanges: IncomeRawChange[]) {
  const previous = incomeParamsOf(income);
  const built = await buildIncomeEditItem(previous, rawChanges);
  if (!built.ok) {
    logActivity(from, "edit_income", built.error);
    await sendText(from, built.error);
    return;
  }
  if (built.views.length === 0) {
    logActivity(from, "edit_income", "pedido sem nenhuma mudanca real");
    await sendText(from, NO_CHANGE_TEXT);
    return;
  }
  const headerText = incomeHeader(previous);
  clearEditConfirmations(from);
  setPendingEditIncome(from, {
    incomeId: income.id,
    description: income.description,
    headerText,
    previous,
    proposed: built.proposed,
    rawChanges: built.rawChanges,
    views: built.views,
    awaitingCorrection: false,
    correctionStage: "pick",
    correctionTarget: null,
  });
  logActivity(from, "edit_income", `pediu confirmacao: #${income.id} ${income.description}: ${built.views.map((v) => `${v.label} ${v.from} -> ${v.to}`).join(", ")}`);
  await sendText(from, formatIncomeEditPreview(headerText, built.views));
}

// refaz a previa com um novo valor pra um campo. Devolve false (e ja respondeu o motivo) se nao serviu.
async function applyIncomeCorrection(from: string, pending: PendingEditIncome, field: IncomeEditField, rawValue: string): Promise<boolean> {
  const noun = INCOME_FIELD_NOUN[field];
  const kind = expenseFieldKind(field);
  const value = rawValue.trim();
  if (!value) {
    await sendText(from, correctionRetry("Não recebi nada.", kind, noun));
    return false;
  }
  // o campo corrigido mantem a posicao que tinha na previa
  const rawChanges = pending.rawChanges.some((c) => c.field === field)
    ? pending.rawChanges.map((c) => (c.field === field ? { field, value } : c))
    : [...pending.rawChanges, { field, value }];
  const built = await buildIncomeEditItem(pending.previous, rawChanges);
  if (!built.ok) {
    await sendText(from, correctionRetry(built.error, kind, noun));
    return false;
  }
  if (built.views.length === 0) {
    clearPendingEditIncome(from);
    logActivity(from, "edit_income", "correcao deixou tudo como estava");
    await sendText(from, NO_CHANGE_TEXT);
    return true;
  }
  setPendingEditIncome(from, {
    ...pending,
    proposed: built.proposed,
    rawChanges: built.rawChanges,
    views: built.views,
    awaitingCorrection: false,
    correctionStage: "pick",
    correctionTarget: null,
  });
  logActivity(from, "edit_income", `correcao: #${pending.incomeId} ${noun} -> ${value}`);
  await sendText(from, formatIncomeEditPreview(pending.headerText, built.views));
  return true;
}

function incomeEditKind(pending: Pick<PendingEditIncome, "views" | "correctionTarget">): CorrectionKind {
  if (pending.correctionTarget) return expenseFieldKind(pending.correctionTarget);
  if (pending.views.length === 1) return expenseFieldKind(pending.views[0].field);
  return "text";
}

async function confirmIncomeEdit(from: string, pending: PendingEditIncome) {
  clearPendingEditIncome(from);
  const current = getIncomeById(from, pending.incomeId);
  if (!current) {
    logActivity(from, "edit_income", `#${pending.incomeId} nao existe mais`);
    await sendText(from, INCOME_GONE_TEXT);
    return;
  }
  if (incomeChangedSince(current, pending.previous)) {
    logActivity(from, "edit_income", `#${pending.incomeId} mudou durante a confirmacao`);
    await sendText(from, incomeChangedText(pending.description, current.amount));
    return;
  }
  updateIncome(from, pending.incomeId, pending.proposed);
  setPendingUndo(from, { kind: "restore_income", incomeId: pending.incomeId, previous: pending.previous, description: pending.description });
  logActivity(from, "edit_income", `confirmado: #${pending.incomeId} ${pending.description}`);
  await sendText(from, formatIncomeEditSuccess(pending.description, pending.views));
}

async function resolveEditIncomeConfirmation(from: string, pending: PendingEditIncome, answerText: string) {
  if (pending.awaitingCorrection) {
    // so a palavra "cancelar" cancela durante a correcao; o resto e a resposta
    if (isCancelWord(answerText)) {
      clearPendingEditIncome(from);
      logActivity(from, "edit_income", `correcao de ${pending.description} cancelada`);
      await sendText(from, "Beleza, não mexi em nada.");
      return;
    }
    if (pending.correctionStage === "pick") {
      const options = incomeCorrectionOptions(pending.views);
      const trimmed = answerText.trim();
      const picked = /^\d+$/.test(trimmed) ? options[Number(trimmed) - 1] : undefined;
      if (!picked) {
        await sendText(from, `Não entendi 🤔\n${formatCorrectionPicker(options)}`);
        return;
      }
      const field = picked.field as IncomeEditField;
      setPendingEditIncome(from, { ...pending, correctionStage: "value", correctionTarget: field });
      await sendText(from, correctionQuestion(expenseFieldKind(field), INCOME_FIELD_NOUN[field]));
      return;
    }
    await applyIncomeCorrection(from, pending, pending.correctionTarget!, answerText);
    return;
  }

  const reply = classifyConfirmationReply(answerText);
  if (reply === "confirm") {
    await confirmIncomeEdit(from, pending);
    return;
  }
  if (reply === "cancel") {
    clearPendingEditIncome(from);
    logActivity(from, "edit_income", `edicao de ${pending.description} nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply === "correct") {
    const options = incomeCorrectionOptions(pending.views);
    if (options.length === 1) {
      const field = options[0].field as IncomeEditField;
      setPendingEditIncome(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: field });
      await sendText(from, correctionQuestion(expenseFieldKind(field), INCOME_FIELD_NOUN[field]));
    } else {
      setPendingEditIncome(from, { ...pending, awaitingCorrection: true, correctionStage: "pick", correctionTarget: null });
      await sendText(from, formatCorrectionPicker(options));
    }
    return;
  }

  // texto livre: so com 1 mudanca de valor ou data (o resto nunca vira novo valor sozinho)
  const kind = incomeEditKind(pending);
  if (acceptsFreeText(kind)) {
    const field = pending.views[0].field;
    let value: string | null = null;
    if (kind === "amount") {
      const parsedAmount = parseBrazilianAmountDetailed(answerText);
      if (parsedAmount.ok || parsedAmount.reason === "not_positive") value = answerText;
    } else {
      const parsed = parseExpenseDate(answerText, spDateString());
      if (parsed.ok || parsed.reason !== "unrecognized") value = answerText;
      else {
        const extracted = await extractDateTimeFromAnswer(answerText);
        value = extracted?.newDate ?? null;
      }
    }
    if (value !== null) {
      const applied = await applyIncomeCorrection(from, pending, field, value);
      if (!applied) setPendingEditIncome(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: field });
      return;
    }
  }
  logActivity(from, "edit_income", `resposta nao entendida na confirmacao de ${pending.description}`);
  await sendText(from, NOT_UNDERSTOOD_TEXT);
}

// exclusao: "1 apagar / 3 cancelar"; qualquer outra coisa (inclusive "2") pergunta de novo
async function resolveDeleteIncomeConfirmation(from: string, pending: PendingDeleteIncome, answerText: string) {
  const reply = classifyConfirmationReply(answerText);
  const description = pending.snapshot.description;
  if (reply === "cancel") {
    clearPendingDeleteIncome(from);
    logActivity(from, "delete_income", `exclusao de "${description}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply !== "confirm") {
    logActivity(from, "delete_income", `resposta nao entendida na confirmacao de "${description}"`);
    await sendText(from, INCOME_DELETE_NOT_UNDERSTOOD);
    return;
  }
  clearPendingDeleteIncome(from);
  const current = getIncomeById(from, pending.incomeId);
  if (!current) {
    await sendText(from, INCOME_GONE_TEXT);
    return;
  }
  if (incomeChangedSince(current, pending.snapshot)) {
    logActivity(from, "delete_income", `#${pending.incomeId} mudou durante a confirmacao`);
    await sendText(from, incomeChangedText(description, current.amount));
    return;
  }
  deleteIncome(from, pending.incomeId);
  setPendingUndo(from, { kind: "recreate_income", params: { fromNumber: from, ...pending.snapshot }, description });
  logActivity(from, "delete_income", `apagada: #${pending.incomeId} ${description}`);
  await sendText(from, incomeDeletedText(description));
}

// ---- gasto(s) ------------------------------------------------------------
// Uma confirmacao vale pra 1 a 5 gastos e pra varias mudancas por gasto. Nada e
// gravado (nem categoria/forma de pagamento nova) antes do "1".

const EXPENSE_FIELD_NOUN: Record<ExpenseEditField, string> = {
  amount: "valor",
  date: "data",
  description: "nome",
  payment_method: "forma de pagamento",
  category: "categoria",
};

function paymentMethodLabel(from: string, id: number | null): string {
  return (id !== null ? getPaymentMethodById(from, id)?.name : null) ?? "—";
}

const NO_CHANGE_TEXT ="Já está assim, não mexi em nada.";
const EDIT_BATCH_LIMIT_TEXT = `Faço até ${MAX_EDIT_BATCH} alterações por vez. Me manda as primeiras ${MAX_EDIT_BATCH} e depois as outras.`;

function expenseFieldKind(field: ExpenseEditField): CorrectionKind {
  return field === "amount" ? "amount" : field === "date" ? "date" : "text";
}

function expenseParamsOf(expense: ExpenseRecord): EditExpenseParams {
  return {
    amount: expense.amount,
    description: expense.description,
    date: expense.date,
    categoryId: expense.category_id,
    paymentMethodId: expense.payment_method_id,
  };
}

// RN04: texto livre so vira nova previa com 1 gasto e 1 mudanca de valor ou data
function expenseEditKind(pending: Pick<PendingEditExpense, "items" | "correctionTarget">): CorrectionKind {
  if (pending.correctionTarget) return expenseFieldKind(pending.correctionTarget.field);
  if (pending.items.length === 1 && pending.items[0].views.length === 1) return expenseFieldKind(pending.items[0].views[0].field);
  return "text";
}

function expenseEditLabel(items: ExpenseEditItem[]): string {
  return items.length === 1 ? items[0].description : `${items.length} gastos`;
}

interface ExpenseEditRequest {
  expense: ExpenseRecord;
  rawChanges: RawChange[];
}

// RN05/RN06: o que da pra validar sem saber o gasto (valor e data impossiveis) e
// validado ANTES de listar candidatos -- o usuario nao escolhe o item pra so
// depois descobrir que o pedido estava errado
function earlyEditError(rawChanges: RawChange[]): string | null {
  for (const change of rawChanges) {
    if (change.field === "amount") {
      const parsed = parseBrazilianAmountDetailed(change.value);
      if (!parsed.ok) return parsed.reason === "not_positive" ? "O valor precisa ser maior que R$ 0,00." : `Não entendi o valor "${change.value}".`;
      const check = validateAmount(parsed.value);
      if (!check.ok) return check.message;
    } else if (change.field === "date") {
      const parsed = parseExpenseDate(change.value, spDateString());
      if (!parsed.ok && parsed.reason !== "unrecognized") return invalidDateMessage(parsed.shown);
    }
  }
  return null;
}

// monta a previa (valida tudo) e so entao guarda a pendencia e pergunta 1/2/3
async function startExpenseEdits(from: string, requests: ExpenseEditRequest[]) {
  const items: ExpenseEditItem[] = [];
  for (const { expense, rawChanges } of requests) {
    const built = await buildExpenseEditItem(from, expense.id, expenseParamsOf(expense), rawChanges);
    if ("error" in built) {
      logActivity(from, "edit_expense", built.error);
      await sendText(from, built.error);
      return;
    }
    if (built.item.views.length > 0) items.push(built.item);
  }
  if (items.length === 0) {
    logActivity(from, "edit_expense", "pedido sem nenhuma mudanca real");
    await sendText(from, NO_CHANGE_TEXT);
    return;
  }
  clearEditConfirmations(from);
  setPendingEditExpense(from, { items, awaitingCorrection: false, correctionStage: "pick", correctionTarget: null });
  logActivity(
    from,
    "edit_expense",
    `pediu confirmacao: ${items.map((i) => `#${i.expenseId} ${i.description}: ${i.views.map((v) => `${v.label} ${v.from} -> ${v.to}`).join(", ")}`).join(" | ")}`
  );
  await sendText(from, formatExpenseEditPreview(items));
}

// acha o gasto de um pedido de edicao (numero da lista, texto ou "o ultimo"),
// perguntando qual quando ha mais de um candidato (Card 2)
async function resolveEditExpenseTarget(
  from: string,
  interpretation: Extract<Interpretation, { type: "edit_expense" }>,
  resolvedTargetId?: number
): Promise<ExpenseRecord | null> {
  if (resolvedTargetId !== undefined || !interpretation.list_ref) {
    const expenseId = await chooseTarget(from, "expense", interpretation, interpretation.query, resolvedTargetId);
    return expenseId === null ? null : getExpenseById(from, expenseId);
  }
  const ids = getLastShownExpenses(from);
  if (ids === null) {
    // RN07: lista expirada -- nunca aplica o numero a outra lista
    await offerRecentExpensesForExpiredList(from, interpretation);
    return null;
  }
  const id = ids[interpretation.list_ref - 1];
  const expense = id ? getExpenseById(from, id) : null;
  if (!expense) {
    logActivity(from, "edit_expense", `referencia "${interpretation.list_ref}" sem lista valida`);
    await sendText(from, `Não sei a que gasto o número "${interpretation.list_ref}" se refere. De qual dia são as compras que você quer editar?`);
    return null;
  }
  return expense;
}

type ExpenseEditAction = Extract<Interpretation, { type: "edit_expense" | "correct_category" }>;

function isExpenseEditAction(interpretation: Interpretation): interpretation is ExpenseEditAction {
  return interpretation.type === "edit_expense" || interpretation.type === "correct_category";
}

function rawChangesOf(action: ExpenseEditAction): RawChange[] {
  return action.type === "correct_category" ? normalizeExpenseChanges({ field: "category", value: action.category }) : normalizeExpenseChanges(action);
}

const BATCH_NEEDS_CHANGES_TEXT = 'Me diz o que mudar em cada gasto, ex: "o mercado foi no pix e o uber no dinheiro".';

// 2+ pedidos de edicao de gasto na mesma mensagem: UMA confirmacao pro lote todo.
// Aqui nao tem lista de candidatos (cada gasto precisa ser identificado sem
// ambiguidade) -- se algum nao for, nao cria nada e pede pra ser mais especifico.
async function startExpenseEditBatch(from: string, actions: ExpenseEditAction[]) {
  const changesByAction: RawChange[][] = [];
  for (const action of actions) {
    const changes = rawChangesOf(action);
    const problem = changes.length === 0 ? BATCH_NEEDS_CHANGES_TEXT : earlyEditError(changes);
    if (problem) {
      logActivity(from, "edit_expense", `lote recusado: ${problem}`);
      await sendText(from, problem);
      return;
    }
    changesByAction.push(changes);
  }

  const shown = getLastShownExpenses(from);
  const groups = new Map<number, ExpenseEditRequest>();
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    let expense: ExpenseRecord | null = null;
    let problem: string | null = null;

    if (action.type === "edit_expense" && action.list_ref) {
      if (shown === null) problem = "A lista de gastos que eu tinha mostrado já expirou. Pede a lista de novo e me manda as alterações.";
      else {
        const id = shown[action.list_ref - 1];
        expense = id ? getExpenseById(from, id) : null;
        if (!expense) problem = `Não sei a que gasto o número "${action.list_ref}" se refere. Pede a lista de novo e me manda as alterações.`;
      }
    } else if (action.query) {
      const found = searchTargets(from, "expense", action.query);
      if (found.total === 0) problem = targetNotFoundText(action, "expense", action.query);
      else if (found.total > 1) {
        problem = `Achei mais de um gasto parecido com "${action.query}". Me manda uma alteração por vez, ou pede a lista dos gastos e usa o número de cada um.`;
      } else expense = getExpenseById(from, found.ids[0]);
    } else {
      expense = findRecentExpense(from);
      if (!expense) problem = targetNotFoundText(action, "expense");
    }

    if (!expense) {
      logActivity(from, "edit_expense", `lote recusado: ${problem}`);
      await sendText(from, problem!);
      return;
    }
    const existing = groups.get(expense.id);
    groups.set(expense.id, { expense, rawChanges: mergeRawChanges(existing?.rawChanges ?? [], changesByAction[i]) });
  }

  if (groups.size > MAX_EDIT_BATCH) {
    logActivity(from, "edit_expense", `lote recusado: ${groups.size} gastos (limite ${MAX_EDIT_BATCH})`);
    await sendText(from, EDIT_BATCH_LIMIT_TEXT);
    return;
  }
  await startExpenseEdits(from, Array.from(groups.values()));
}

// refaz um item com um novo valor pra um campo e reenvia a previa. Devolve
// false (e ja respondeu o motivo) quando o valor nao serve.
async function applyExpenseCorrection(from: string, pending: PendingEditExpense, itemIndex: number, field: ExpenseEditField, rawValue: string): Promise<boolean> {
  const noun = EXPENSE_FIELD_NOUN[field];
  let value = rawValue.trim();
  if (!value) {
    await sendText(from, correctionRetry("Não recebi nada.", expenseFieldKind(field), noun));
    return false;
  }
  if (field === "category" && value.split(/\s+/).filter(Boolean).length > 3) {
    value = findCategoryMentionedIn(from, value)?.name ?? (await extractCategoryFromAnswer(value));
  }
  const item = pending.items[itemIndex];
  const built = await buildExpenseEditItem(from, item.expenseId, item.previous, mergeRawChanges(item.rawChanges, [{ field, value }]));
  if ("error" in built) {
    await sendText(from, correctionRetry(built.error, expenseFieldKind(field), noun));
    return false;
  }
  const items = pending.items.map((it, idx) => (idx === itemIndex ? built.item : it)).filter((it) => it.views.length > 0);
  if (items.length === 0) {
    clearPendingEditExpense(from);
    logActivity(from, "edit_expense", "correcao deixou tudo como estava");
    await sendText(from, NO_CHANGE_TEXT);
    return true;
  }
  setPendingEditExpense(from, { items, awaitingCorrection: false, correctionStage: "pick", correctionTarget: null });
  logActivity(from, "edit_expense", `correcao: #${item.expenseId} ${noun} -> ${value}`);
  await sendText(from, formatExpenseEditPreview(items));
  return true;
}

// RN09: antes de gravar, confere se cada gasto ainda existe e e igual ao da previa
function expenseChangedSince(current: ExpenseRecord, previous: EditExpenseParams): boolean {
  return (
    current.amount !== previous.amount ||
    current.description !== previous.description ||
    current.date !== previous.date ||
    current.category_id !== previous.categoryId ||
    current.payment_method_id !== previous.paymentMethodId
  );
}

async function confirmExpenseEdits(from: string, pending: PendingEditExpense) {
  clearPendingEditExpense(from);
  for (const item of pending.items) {
    const current = getExpenseById(from, item.expenseId);
    if (!current) {
      logActivity(from, "edit_expense", `#${item.expenseId} nao existe mais`);
      await sendText(from, "Não achei mais esse item.");
      return;
    }
    if (expenseChangedSince(current, item.previous)) {
      logActivity(from, "edit_expense", `#${item.expenseId} mudou durante a confirmacao`);
      await sendText(from, `O gasto "${item.description}" mudou enquanto a gente conversava (agora está ${formatBRL(current.amount)}). Me pede a alteração de novo.`);
      return;
    }
  }

  // tudo ou nada: categoria/forma de pagamento nova so nasce aqui, junto com as edicoes
  withTransaction(() => {
    for (const item of pending.items) {
      const params = { ...item.proposed };
      if (item.newPaymentMethodName) params.paymentMethodId = getOrCreatePaymentMethod(from, item.newPaymentMethodName).id;
      if (item.newCategoryName) params.categoryId = getOrCreateCategory(from, item.newCategoryName).id;
      updateExpense(from, item.expenseId, params);
      if (params.categoryId !== null && params.categoryId !== item.previous.categoryId) learnKeyword(from, params.description, params.categoryId);
    }
  });

  if (pending.items.length === 1) {
    const item = pending.items[0];
    setPendingUndo(from, { kind: "restore_expense", expenseId: item.expenseId, previous: item.previous, description: item.previous.description });
  } else {
    setPendingUndo(from, {
      kind: "restore_expenses_batch",
      items: pending.items.map((item) => ({ expenseId: item.expenseId, previous: item.previous, description: item.previous.description })),
      description: `${pending.items.length} gastos`,
    });
  }
  logActivity(from, "edit_expense", `confirmado: ${pending.items.map((i) => `#${i.expenseId} ${i.description}`).join(", ")}`);
  await sendText(from, formatExpenseEditSuccess(pending.items));
}

async function resolveEditExpenseConfirmation(from: string, pending: PendingEditExpense, answerText: string) {
  const label = expenseEditLabel(pending.items);

  if (pending.awaitingCorrection) {
    // RN06: durante a correcao so a palavra "cancelar" cancela; o resto e a resposta
    if (isCancelWord(answerText)) {
      clearPendingEditExpense(from);
      logActivity(from, "edit_expense", `correcao de ${label} cancelada`);
      await sendText(from, "Beleza, não mexi em nada.");
      return;
    }
    if (pending.correctionStage === "pick") {
      const options = correctionOptions(pending.items);
      const trimmed = answerText.trim();
      const picked = /^\d+$/.test(trimmed) ? options[Number(trimmed) - 1] : undefined;
      if (!picked) {
        await sendText(from, `Não entendi 🤔\n${formatCorrectionPicker(options)}`);
        return;
      }
      setPendingEditExpense(from, { ...pending, correctionStage: "value", correctionTarget: { itemIndex: picked.itemIndex, field: picked.field } });
      logActivity(from, "edit_expense", `corrigindo ${picked.label}`);
      await sendText(from, correctionQuestion(expenseFieldKind(picked.field), EXPENSE_FIELD_NOUN[picked.field]));
      return;
    }
    const target = pending.correctionTarget!;
    await applyExpenseCorrection(from, pending, target.itemIndex, target.field, answerText);
    return;
  }

  const reply = classifyConfirmationReply(answerText);

  if (reply === "confirm") {
    await confirmExpenseEdits(from, pending);
    return;
  }
  if (reply === "cancel") {
    clearPendingEditExpense(from);
    logActivity(from, "edit_expense", `edicao de ${label} nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply === "correct") {
    const options = correctionOptions(pending.items);
    if (options.length === 1) {
      setPendingEditExpense(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: { itemIndex: options[0].itemIndex, field: options[0].field } });
      logActivity(from, "edit_expense", `pediu pra corrigir ${options[0].label} de ${label}`);
      await sendText(from, correctionQuestion(expenseFieldKind(options[0].field), EXPENSE_FIELD_NOUN[options[0].field]));
    } else {
      setPendingEditExpense(from, { ...pending, awaitingCorrection: true, correctionStage: "pick", correctionTarget: null });
      logActivity(from, "edit_expense", `pediu pra corrigir ${label} (escolhendo qual)`);
      await sendText(from, formatCorrectionPicker(options));
    }
    return;
  }

  // texto livre: so com 1 gasto e 1 mudanca de valor/data (RN04)
  const kind = expenseEditKind(pending);
  if (acceptsFreeText(kind)) {
    const field = pending.items[0].views[0].field;
    let value: string | null = null;
    if (kind === "amount") {
      const parsedAmount = parseBrazilianAmountDetailed(answerText);
      if (parsedAmount.ok || parsedAmount.reason === "not_positive") value = answerText;
    } else {
      const parsed = parseExpenseDate(answerText, spDateString());
      if (parsed.ok || parsed.reason !== "unrecognized") value = answerText;
      else {
        const extracted = await extractDateTimeFromAnswer(answerText);
        value = extracted?.newDate ?? null;
      }
    }
    if (value !== null) {
      const applied = await applyExpenseCorrection(from, pending, 0, field, value);
      // valor recusado: fica esperando o valor certo (a pergunta ja foi repetida)
      if (!applied) setPendingEditExpense(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: { itemIndex: 0, field } });
      return;
    }
  }
  logActivity(from, "edit_expense", `resposta nao entendida na confirmacao de ${label}`);
  await sendText(from, NOT_UNDERSTOOD_TEXT);
}

// ---- evento ----------------------------------------------------------------

function eventSnapshotOf(event: EventRow): EventSnapshot {
  return { title: event.title, start: event.start, end: event.end, location: event.location, reminderMinutes: event.reminder_minutes };
}

const EVENT_CHANGE_KIND: Record<EventChangeKey, CorrectionKind> = {
  datetime: "datetime",
  end: "endtime",
  title: "text",
  location: "location",
  lead: "lead",
};

const EVENT_CHANGE_NOUN: Record<EventChangeKey, string> = {
  datetime: "data e hora",
  end: "término",
  title: "nome",
  location: "local",
  lead: "aviso",
};

function currentEventChanges(pending: Pick<PendingEditEvent, "previous" | "proposed" | "endSpec">) {
  return eventChanges(pending.previous, pending.proposed, pending.endSpec);
}

// tipo de valor que a proxima resposta espera: o campo escolhido na correcao ou, sem
// escolha, o da unica mudanca (com varias mudancas nenhuma resposta solta vira valor)
function eventEditKind(pending: Pick<PendingEditEvent, "previous" | "proposed" | "endSpec" | "correctionTarget">): CorrectionKind {
  if (pending.correctionTarget) return EVENT_CHANGE_KIND[pending.correctionTarget];
  const changes = currentEventChanges(pending);
  return changes.length === 1 ? EVENT_CHANGE_KIND[changes[0].key] : "text";
}

function buildEventPreview(pending: Omit<PendingEditEvent, "createdAt">): string {
  return formatEditPreview(pending.headerText, currentEventChanges(pending));
}

// refaz a previa com um novo valor pro campo e recalcula o termino (RN02). Devolve false
// (e ja respondeu o motivo) quando o valor nao serve.
async function applyEventCorrection(from: string, pending: PendingEditEvent, key: EventChangeKey, value: CorrectionValue): Promise<boolean> {
  const proposed = { ...pending.proposed };
  let endSpec = pending.endSpec;
  if (value.kind === "datetime") {
    // mescla com o valor JA PROPOSTO (nao o original do evento) -- se a correcao so
    // mencionar o dia, mantem a hora que ja tinha sido proposta antes
    proposed.start = mergeDateTime(pending.proposed.start, value.newDate, value.newTime);
  } else if (value.kind === "endtime") {
    endSpec = value.spec;
  } else if (value.kind === "text") {
    proposed.title = value.text;
  } else if (value.kind === "location") {
    proposed.location = value.location;
  } else if (value.kind === "lead") {
    proposed.reminderMinutes = value.minutes;
  }
  const end = computeProposedEnd(pending.previous, proposed.start, endSpec);
  if (!end.ok) {
    await sendText(from, correctionRetry(end.error, EVENT_CHANGE_KIND[key], EVENT_CHANGE_NOUN[key]));
    return false;
  }
  proposed.end = end.end;
  const changes = eventChanges(pending.previous, proposed, endSpec);
  if (changes.length === 0) {
    clearPendingEditEvent(from);
    logActivity(from, "edit_event", `correcao deixou "${pending.title}" como estava`);
    await sendText(from, NO_CHANGE_TEXT);
    return true;
  }
  const next = { ...pending, proposed, endSpec, changeText: eventChangeText(changes), awaitingCorrection: false, correctionStage: "pick" as const, correctionTarget: null };
  setPendingEditEvent(from, next);
  logActivity(from, "edit_event", `correcao: "${pending.title}": ${next.changeText}`);
  await sendText(from, buildEventPreview(next));
  return true;
}

async function resolveEditEventConfirmation(from: string, pending: PendingEditEvent, answerText: string) {
  if (pending.awaitingCorrection) {
    // RN06: durante a correcao so a palavra "cancelar" cancela; o resto e o novo valor
    if (isCancelWord(answerText)) {
      clearPendingEditEvent(from);
      logActivity(from, "edit_event", `correcao de "${pending.title}" cancelada`);
      await sendText(from, "Beleza, não mexi em nada.");
      return;
    }
    if (pending.correctionStage === "pick") {
      const changes = currentEventChanges(pending);
      const trimmed = answerText.trim();
      const picked = /^\d+$/.test(trimmed) ? changes[Number(trimmed) - 1] : undefined;
      if (!picked) {
        await sendText(from, `Não entendi 🤔\n${formatCorrectionLabels(changes.map((c) => c.label))}`);
        return;
      }
      setPendingEditEvent(from, { ...pending, correctionStage: "value", correctionTarget: picked.key });
      logActivity(from, "edit_event", `corrigindo ${picked.label} de "${pending.title}"`);
      await sendText(from, correctionQuestion(EVENT_CHANGE_KIND[picked.key], EVENT_CHANGE_NOUN[picked.key]));
      return;
    }
    const key = pending.correctionTarget!;
    const kind = EVENT_CHANGE_KIND[key];
    const interpreted = await interpretCorrection(kind, answerText, { startIso: pending.proposed.start });
    if ("error" in interpreted) {
      await sendText(from, correctionRetry(interpreted.error, kind, EVENT_CHANGE_NOUN[key]));
      return;
    }
    await applyEventCorrection(from, pending, key, interpreted.value);
    return;
  }

  const reply = classifyConfirmationReply(answerText);

  if (reply === "confirm") {
    clearPendingEditEvent(from);
    if (!getEventById(from, pending.eventId)) {
      await sendText(from, "Não achei mais esse item.");
      return;
    }
    updateEvent(from, pending.eventId, {
      title: pending.proposed.title,
      start: pending.proposed.start,
      end: pending.proposed.end,
      location: pending.proposed.location ?? undefined,
      reminderMinutes: pending.proposed.reminderMinutes,
    });
    setPendingUndo(from, {
      kind: "restore_event_time",
      eventId: pending.eventId,
      previous: pending.previous,
      description: pending.title,
    });
    logActivity(from, "edit_event", `confirmado: "${pending.title}": ${pending.changeText}`);
    await sendText(from, `✏️ "${pending.title}" alterado: ${pending.changeText}`);
    return;
  }
  if (reply === "cancel") {
    clearPendingEditEvent(from);
    logActivity(from, "edit_event", `alteracao de "${pending.title}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply === "correct") {
    const changes = currentEventChanges(pending);
    if (changes.length === 1) {
      const key = changes[0].key;
      setPendingEditEvent(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: key });
      logActivity(from, "edit_event", `pediu pra corrigir ${changes[0].label} de "${pending.title}"`);
      await sendText(from, correctionQuestion(EVENT_CHANGE_KIND[key], EVENT_CHANGE_NOUN[key]));
    } else {
      setPendingEditEvent(from, { ...pending, awaitingCorrection: true, correctionStage: "pick", correctionTarget: null });
      logActivity(from, "edit_event", `pediu pra corrigir "${pending.title}" (escolhendo qual)`);
      await sendText(from, formatCorrectionLabels(changes.map((c) => c.label)));
    }
    return;
  }

  const kind = eventEditKind(pending);
  if (acceptsFreeText(kind)) {
    const key = currentEventChanges(pending)[0].key;
    const interpreted = await interpretCorrection(kind, answerText, { startIso: pending.proposed.start });
    if (!("error" in interpreted)) {
      await applyEventCorrection(from, pending, key, interpreted.value);
      return;
    }
  }
  logActivity(from, "edit_event", `resposta nao entendida na confirmacao de "${pending.title}"`);
  await sendText(from, NOT_UNDERSTOOD_TEXT);
}

// ---- lembrete --------------------------------------------------------------

type ReminderChangeKey = "datetime" | "text";

const REMINDER_KEY_KIND: Record<ReminderChangeKey, CorrectionKind> = { datetime: "datetime", text: "text" };
const REMINDER_KEY_LABEL: Record<ReminderChangeKey, string> = { datetime: "Quando", text: "Texto" };

// as mudancas do lembrete, na ordem da previa (Quando, Texto)
function reminderChangeKeys(pending: Pick<PendingEditReminder, "isDateTimeChange" | "message" | "proposedMessage">): ReminderChangeKey[] {
  const keys: ReminderChangeKey[] = [];
  if (pending.isDateTimeChange) keys.push("datetime");
  if (pending.proposedMessage !== pending.message) keys.push("text");
  return keys;
}

function reminderCorrectionKind(pending: Pick<PendingEditReminder, "isDateTimeChange" | "message" | "proposedMessage" | "correctionTarget">): CorrectionKind {
  if (pending.correctionTarget) return REMINDER_KEY_KIND[pending.correctionTarget];
  const keys = reminderChangeKeys(pending);
  return keys.length === 1 ? REMINDER_KEY_KIND[keys[0]] : "text";
}

function buildReminderPreview(pending: Omit<PendingEditReminder, "createdAt">): string {
  const changes: PreviewChange[] = [];
  if (pending.isDateTimeChange) changes.push({ label: "Quando", from: formatWhen(pending.previousDueAt), to: formatWhen(pending.proposedDueAt) });
  if (pending.proposedMessage !== pending.message) changes.push({ label: "Texto", from: pending.message, to: pending.proposedMessage });
  return formatEditPreview(pending.headerText, changes);
}

function buildReminderChangeText(pending: Pick<PendingEditReminder, "isDateTimeChange" | "previousDueAt" | "proposedDueAt" | "message" | "proposedMessage">): string {
  const parts: string[] = [];
  if (pending.isDateTimeChange) parts.push(`de ${formatDateTime(pending.previousDueAt)} pra ${formatDateTime(pending.proposedDueAt)}`);
  if (pending.proposedMessage !== pending.message) parts.push(`texto "${pending.message}" → "${pending.proposedMessage}"`);
  return parts.join("; ");
}

async function resolveEditReminderConfirmation(from: string, pending: PendingEditReminder, answerText: string) {
  const noun = "texto";

  const applyCorrection = async (value: CorrectionValue) => {
    const next = { ...pending, awaitingCorrection: false, correctionStage: "pick" as const, correctionTarget: null };
    if (value.kind === "datetime") next.proposedDueAt = mergeDateTime(pending.proposedDueAt, value.newDate, value.newTime);
    else if (value.kind === "text") next.proposedMessage = value.text;
    next.changeText = buildReminderChangeText(next);
    setPendingEditReminder(from, next);
    logActivity(from, "edit_reminder", `correcao: "${pending.message}": ${next.changeText}`);
    await sendText(from, buildReminderPreview(next));
  };

  if (pending.awaitingCorrection) {
    // RN06: durante a correcao so a palavra "cancelar" cancela; o resto e o novo valor
    if (isCancelWord(answerText)) {
      clearPendingEditReminder(from);
      logActivity(from, "edit_reminder", `correcao de "${pending.message}" cancelada`);
      await sendText(from, "Beleza, não mexi em nada.");
      return;
    }
    if (pending.correctionStage === "pick") {
      const keys = reminderChangeKeys(pending);
      const trimmed = answerText.trim();
      const picked = /^\d+$/.test(trimmed) ? keys[Number(trimmed) - 1] : undefined;
      if (!picked) {
        await sendText(from, `Não entendi 🤔\n${formatCorrectionLabels(keys.map((k) => REMINDER_KEY_LABEL[k]))}`);
        return;
      }
      setPendingEditReminder(from, { ...pending, correctionStage: "value", correctionTarget: picked });
      await sendText(from, correctionQuestion(REMINDER_KEY_KIND[picked], picked === "text" ? noun : "data e hora"));
      return;
    }
    const kind = reminderCorrectionKind(pending);
    const interpreted = await interpretCorrection(kind, answerText);
    if ("error" in interpreted) {
      await sendText(from, correctionRetry(interpreted.error, kind, noun));
      return;
    }
    await applyCorrection(interpreted.value);
    return;
  }

  const reply = classifyConfirmationReply(answerText);

  if (reply === "confirm") {
    clearPendingEditReminder(from);
    if (!getReminderById(from, pending.reminderId)) {
      await sendText(from, "Não achei mais esse item.");
      return;
    }
    updateReminder(from, pending.reminderId, { message: pending.proposedMessage, dueAt: pending.proposedDueAt });
    setPendingUndo(from, {
      kind: "restore_reminder_time",
      reminderId: pending.reminderId,
      previousDueAt: pending.previousDueAt,
      description: pending.message,
    });
    logActivity(from, "edit_reminder", `confirmado: "${pending.message}": ${pending.changeText}`);
    await sendText(from, `✏️ Lembrete "${pending.message}" alterado: ${pending.changeText}`);
    return;
  }
  if (reply === "cancel") {
    clearPendingEditReminder(from);
    logActivity(from, "edit_reminder", `alteracao de "${pending.message}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply === "correct") {
    const keys = reminderChangeKeys(pending);
    if (keys.length === 1) {
      setPendingEditReminder(from, { ...pending, awaitingCorrection: true, correctionStage: "value", correctionTarget: keys[0] });
      logActivity(from, "edit_reminder", `pediu pra corrigir "${pending.message}"`);
      await sendText(from, correctionQuestion(REMINDER_KEY_KIND[keys[0]], keys[0] === "text" ? noun : "data e hora"));
    } else {
      setPendingEditReminder(from, { ...pending, awaitingCorrection: true, correctionStage: "pick", correctionTarget: null });
      logActivity(from, "edit_reminder", `pediu pra corrigir "${pending.message}" (escolhendo qual)`);
      await sendText(from, formatCorrectionLabels(keys.map((k) => REMINDER_KEY_LABEL[k])));
    }
    return;
  }

  const kind = reminderCorrectionKind(pending);
  if (acceptsFreeText(kind)) {
    const interpreted = await interpretCorrection(kind, answerText);
    if (!("error" in interpreted)) {
      await applyCorrection(interpreted.value);
      return;
    }
  }
  logActivity(from, "edit_reminder", `resposta nao entendida na confirmacao de "${pending.message}"`);
  await sendText(from, NOT_UNDERSTOOD_TEXT);
}

// resposta a "confirma que quer remover o orcamento de X?" -- so remove de
// verdade com um "sim" claro, igual as outras confirmacoes de exclusao
async function resolveRemoveBudgetConfirmation(from: string, pending: PendingRemoveBudget, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

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
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

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

// ---- gasto fixo ------------------------------------------------------------

// qual campo a opcao 2 (corrigir) pergunta: o primeiro que mudou, nessa ordem
function recurringCorrectionTarget(pending: Pick<PendingEditRecurring, "previous" | "proposedParams" | "newCategoryName" | "newPaymentMethodName">): {
  kind: CorrectionKind;
  noun: string;
  field: "amount" | "dayOfMonth" | "description" | "categoryId" | "paymentMethodId";
} {
  const p = pending.previous;
  const n = pending.proposedParams;
  if (n.amount !== p.amount) return { kind: "amount", noun: "valor", field: "amount" };
  if (n.dayOfMonth !== p.dayOfMonth) return { kind: "day", noun: "dia", field: "dayOfMonth" };
  if (n.description !== p.description) return { kind: "text", noun: "nome", field: "description" };
  if (n.categoryId !== p.categoryId || pending.newCategoryName) return { kind: "text", noun: "categoria", field: "categoryId" };
  return { kind: "text", noun: "forma de pagamento", field: "paymentMethodId" };
}

function categoryLabel(from: string, id: number | null): string {
  return (id !== null ? getCategoryById(from, id)?.name : null) ?? "—";
}

function buildRecurringPreview(from: string, pending: Omit<PendingEditRecurring, "createdAt">): string {
  const p = pending.previous;
  const n = pending.proposedParams;
  const changes: PreviewChange[] = [];
  if (n.description !== p.description) changes.push({ label: "Nome", from: p.description, to: n.description });
  if (n.amount !== p.amount) changes.push({ label: "Valor", from: formatBRL(p.amount), to: formatBRL(n.amount) });
  if (n.dayOfMonth !== p.dayOfMonth) changes.push({ label: "Dia do mês", from: String(p.dayOfMonth), to: String(n.dayOfMonth) });
  if (n.categoryId !== p.categoryId || pending.newCategoryName) {
    const to = pending.newCategoryName ? `${pending.newCategoryName} (nova)` : categoryLabel(from, n.categoryId);
    changes.push({ label: "Categoria", from: categoryLabel(from, p.categoryId), to });
  }
  if (n.paymentMethodId !== p.paymentMethodId || pending.newPaymentMethodName) {
    const to = pending.newPaymentMethodName ? `${pending.newPaymentMethodName} (nova)` : paymentMethodLabel(from, n.paymentMethodId);
    changes.push({ label: "Forma de pagamento", from: paymentMethodLabel(from, p.paymentMethodId), to });
  }
  return formatEditPreview(pending.headerText, changes);
}

function buildRecurringChangeText(
  from: string,
  pending: Pick<PendingEditRecurring, "previous" | "proposedParams" | "newCategoryName" | "newPaymentMethodName">
): string {
  const p = pending.previous;
  const n = pending.proposedParams;
  const parts: string[] = [];
  if (n.description !== p.description) parts.push(`nome "${p.description}" → "${n.description}"`);
  if (n.amount !== p.amount) parts.push(`valor R$${p.amount.toFixed(2)} → R$${n.amount.toFixed(2)}`);
  if (n.categoryId !== p.categoryId || pending.newCategoryName) parts.push(`categoria → ${pending.newCategoryName ?? categoryLabel(from, n.categoryId)}`);
  if (n.dayOfMonth !== p.dayOfMonth) parts.push(`dia do mês ${p.dayOfMonth} → ${n.dayOfMonth}`);
  if (n.paymentMethodId !== p.paymentMethodId || pending.newPaymentMethodName) {
    parts.push(`forma de pagamento → ${pending.newPaymentMethodName ?? paymentMethodLabel(from, n.paymentMethodId)}`);
  }
  return parts.join("; ");
}

// mesma ideia das outras confirmacoes de edicao, pra gasto fixo
async function resolveEditRecurringConfirmation(from: string, pending: PendingEditRecurring, answerText: string) {
  const target = recurringCorrectionTarget(pending);

  const applyCorrection = async (value: CorrectionValue) => {
    const proposedParams = { ...pending.proposedParams };
    let newCategoryName = pending.newCategoryName ?? null;
    let newPaymentMethodName = pending.newPaymentMethodName ?? null;
    if (value.kind === "amount") proposedParams.amount = value.amount;
    else if (value.kind === "day") proposedParams.dayOfMonth = value.day;
    else if (value.kind === "text" && target.field === "description") proposedParams.description = value.text;
    else if (value.kind === "text" && target.field === "categoryId") {
      // RN07: nada e criado antes do "1"
      const found = findCategoryByName(from, value.text);
      newCategoryName = found ? null : value.text;
      proposedParams.categoryId = found ? found.id : pending.previous.categoryId;
    } else if (value.kind === "text") {
      const found = findPaymentMethodByName(from, value.text);
      newPaymentMethodName = found ? null : value.text;
      proposedParams.paymentMethodId = found ? found.id : pending.previous.paymentMethodId;
    }
    const next = { ...pending, proposedParams, newCategoryName, newPaymentMethodName, awaitingCorrection: false, changeText: "" };
    next.changeText = buildRecurringChangeText(from, next);
    setPendingEditRecurring(from, next);
    logActivity(from, "edit_recurring_expense", `correcao: "${pending.previous.description}": ${next.changeText}`);
    await sendText(from, buildRecurringPreview(from, next));
  };

  if (pending.awaitingCorrection) {
    // RN06: durante a correcao so a palavra "cancelar" cancela; o resto e o novo valor
    if (isCancelWord(answerText)) {
      clearPendingEditRecurring(from);
      logActivity(from, "edit_recurring_expense", `correcao de "${pending.previous.description}" cancelada`);
      await sendText(from, "Beleza, não mexi em nada.");
      return;
    }
    const interpreted = await interpretCorrection(target.kind, answerText);
    if ("error" in interpreted) {
      await sendText(from, correctionRetry(interpreted.error, target.kind, target.noun));
      return;
    }
    await applyCorrection(interpreted.value);
    return;
  }

  const reply = classifyConfirmationReply(answerText);

  if (reply === "confirm") {
    clearPendingEditRecurring(from);
    if (!getRecurringExpenseById(from, pending.recurringId)?.active) {
      await sendText(from, "Não achei mais esse item.");
      return;
    }
    // criacao adiada: categoria / forma de pagamento novas nascem junto com a edicao
    const finalParams = { ...pending.proposedParams };
    const updated = withTransaction(() => {
      if (pending.newPaymentMethodName) finalParams.paymentMethodId = getOrCreatePaymentMethod(from, pending.newPaymentMethodName).id;
      if (pending.newCategoryName) finalParams.categoryId = getOrCreateCategory(from, pending.newCategoryName).id;
      return updateRecurringExpense(from, pending.recurringId, finalParams);
    });
    if (!updated) {
      await sendText(from, "Não achei mais esse item.");
      return;
    }
    setPendingUndo(from, {
      kind: "restore_recurring_expense_fields",
      recurringId: pending.recurringId,
      previous: pending.previous,
      description: pending.previous.description,
    });
    logActivity(from, "edit_recurring_expense", `confirmado: "${updated.description}": ${pending.changeText}`);
    await sendText(from, `✏️ Gasto fixo "${updated.description}" alterado: ${pending.changeText}`);
    return;
  }
  if (reply === "cancel") {
    clearPendingEditRecurring(from);
    logActivity(from, "edit_recurring_expense", `alteracao de "${pending.previous.description}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }
  if (reply === "correct") {
    setPendingEditRecurring(from, { ...pending, awaitingCorrection: true });
    logActivity(from, "edit_recurring_expense", `pediu pra corrigir "${pending.previous.description}"`);
    await sendText(from, correctionQuestion(target.kind, target.noun));
    return;
  }

  if (acceptsFreeText(target.kind)) {
    const interpreted = await interpretCorrection(target.kind, answerText);
    if (!("error" in interpreted)) {
      await applyCorrection(interpreted.value);
      return;
    }
  }
  logActivity(from, "edit_recurring_expense", `resposta nao entendida na confirmacao de "${pending.previous.description}"`);
  await sendText(from, NOT_UNDERSTOOD_TEXT);
}

// mesma ideia de resolveRemoveRecurringConfirmation, pra alerta de conta fixa
async function resolveRemoveBillAlertConfirmation(from: string, pending: PendingRemoveBillAlert, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const yes = /^(sim|s|confirmo|confirma|pode|isso|exato|certo|ok|blz|beleza|claro|perfeito|com certeza|certeza|manda|fechado|positivo)\b/.test(normalized);
  const no = /^(n[aã]o|n|cancela|deixa|espera|para|negativo|nem)\b/.test(normalized);

  if (!yes && !no) {
    await sendText(from, `Não entendi — confirma que quer parar de receber o alerta de "${pending.name}"? Responde "sim" ou "não".`);
    return;
  }

  clearPendingRemoveBillAlert(from);
  if (no) {
    logActivity(from, "remove_bill_alert", `remocao de "${pending.name}" nao confirmada`);
    await sendText(from, "Beleza, não mexi em nada.");
    return;
  }

  deactivateBillAlert(from, pending.billAlertId);
  setPendingUndo(from, {
    kind: "restore_bill_alert",
    params:
      pending.recurrenceType === "interval"
        ? { fromNumber: from, name: pending.name, intervalDays: pending.intervalDays! }
        : { fromNumber: from, name: pending.name, dayOfMonth: pending.dayOfMonth },
    description: pending.name,
  });
  logActivity(from, "remove_bill_alert", `confirmado: "${pending.name}" removido`);
  await sendText(from, `✅ Alerta de "${pending.name}" removido. Não vou mais te perguntar sobre isso.`);
}

// Resposta a pergunta "ja fez X, ou quer que eu lembre amanha?" (disparada
// pelo scheduler, ver bills/scheduler.ts). So duas saidas possiveis, sem
// meio-termo -- se nao reconhecer nenhuma, pergunta nas mesmas duas opcoes de
// novo, sem deixar a pendencia sem resposta.
async function resolveBillCheckinAnswer(from: string, pending: PendingBillCheckin, answerText: string) {
  const normalized = answerText.trim().toLowerCase();
  const paid = /^(sim|s|j[aá] paguei|paguei|pago|quitei|j[aá] fiz|fiz|j[aá] comprei|comprei|resolvido|resolvi|feito|confirmo|confirma)\b/.test(
    normalized
  );
  const snooze = /^(n[aã]o|n|ainda n[aã]o|amanh[aã]|lembra|manda amanh[aã]|depois|mais tarde)\b/.test(normalized);

  if (!paid && !snooze) {
    await sendText(from, `Não entendi — já resolveu "${pending.name}", ou quer que eu lembre amanhã?`);
    return;
  }

  clearPendingBillCheckin(from);
  const today = spDateString();
  if (paid) {
    confirmBillAlertPaid(from, pending.billAlertId, today);
    logActivity(from, "bill_alert", `confirmado: ${pending.name}`);
    const nextLabel = pending.recurrenceType === "interval" ? `daqui a ${pending.intervalDays} dias` : "mês que vem, no dia certo";
    await sendText(from, `👍 Show, anotado. Te aviso de novo de "${pending.name}" ${nextLabel}.`);
    return;
  }

  snoozeBillAlert(from, pending.billAlertId, addDaysToDateString(today, 1));
  logActivity(from, "bill_alert", `adiado pra amanha: ${pending.name}`);
  await sendText(from, `Combinado, te lembro de "${pending.name}" amanhã de novo.`);
}

async function handleInterpretation(from: string, interpretation: Interpretation, resolvedTargetId?: number) {
  // "editar o 2" so faz sentido logo depois de uma lista mostrada; qualquer outro
  // pedido no meio invalida essa referencia por numero
  if (interpretation.type !== "list_expenses" && interpretation.type !== "edit_expense" && interpretation.type !== "total_last_list" && interpretation.type !== "delete_expense") {
    clearLastShownExpenses(from);
  }

  // idem pra lista de entradas: so list_incomes/edit_income/delete_income a mantem
  if (interpretation.type !== "list_incomes" && interpretation.type !== "edit_income" && interpretation.type !== "delete_income") {
    clearLastShownIncomes(from);
  }

  switch (interpretation.type) {
    case "expense": {
      // a IA nem sempre preenche descricao/data em mensagens bem curtas ("gastei 60 no mercado")
      const description = interpretation.description?.trim() || interpretation.category;
      if (!description) {
        // nem descricao nem categoria vieram -- nao deveria classificar como
        // expense assim (deveria virar unknown), mas por seguranca pede o
        // que falta em vez de registrar um gasto sem nome nenhum
        const started = await maybeStartPendingCompletion(from, { type: "unknown", likely_intent: "expense", amount: interpretation.amount });
        if (!started) await sendText(from, unknownFollowUp("expense"));
        break;
      }
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
      if (!interpretation.category?.trim()) {
        await sendText(from, "Não entendi pra qual categoria mudar. Me diga, ex: \"muda o mercado pra lazer\".");
        break;
      }
      const expenseId = await chooseTarget(from, "expense", interpretation, interpretation.query, resolvedTargetId);
      if (expenseId === null) break;
      await startExpenseEdits(from, [{ expense: getExpenseById(from, expenseId)!, rawChanges: rawChangesOf(interpretation) }]);
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
      const eventId = await chooseTarget(from, "event", interpretation, interpretation.query, resolvedTargetId);
      if (eventId === null) break;
      const event = getEventById(from, eventId)!;
      setPendingEventDeletion(from, event.id, event.title);
      logActivity(from, "delete_event", `pediu confirmacao pra cancelar "${event.title}"`);
      await sendText(
        from,
        `Encontrei "${event.title}" em ${formatDateTime(event.start)}. Confirma que quer cancelar? Responde "sim" ou "não".`
      );
      break;
    }
    case "edit_event": {
      const hasDateTimeChange = Boolean(interpretation.new_date || interpretation.new_time);
      const newLocation = interpretation.new_location?.trim();
      const endTime = interpretation.new_end_time?.trim();
      const duration = interpretation.new_duration_minutes;
      const hasEndChange = Boolean(endTime) || duration !== undefined;
      const hasLocationChange = Boolean(newLocation) || interpretation.clear_location === true;
      if (
        interpretation.new_reminder_minutes !== undefined &&
        (interpretation.new_reminder_minutes < 0 || interpretation.new_reminder_minutes > 43200)
      ) {
        await sendText(from, "A antecedência do aviso precisa ser entre 0 (na hora) e 30 dias antes.");
        break;
      }
      if (endTime && !/^\d{1,2}:\d{2}$/.test(endTime)) {
        await sendText(from, END_NOT_UNDERSTOOD_TEXT);
        break;
      }
      if (!endTime && duration !== undefined && (duration < MIN_EVENT_MINUTES || duration > MAX_EVENT_MINUTES)) {
        await sendText(from, DURATION_RANGE_TEXT);
        break;
      }
      if (newLocation && newLocation.length > MAX_LOCATION_LENGTH) {
        await sendText(from, `Esse texto está muito longo (máximo ${MAX_LOCATION_LENGTH} caracteres).`);
        break;
      }

      const eventId = await chooseTarget(from, "event", interpretation, interpretation.query, resolvedTargetId);
      if (eventId === null) break;
      // RN01: sem mudanca explicita abre o menu de campos
      if (!hasDateTimeChange && !interpretation.new_title && interpretation.new_reminder_minutes === undefined && !hasEndChange && !hasLocationChange) {
        await openFieldMenu(from, "event", eventId);
        break;
      }
      const event = getEventById(from, eventId)!;
      const previous = eventSnapshotOf(event);
      const proposed: EventSnapshot = { ...previous };
      // preenche so o que foi pedido -- "muda so o dia" mantem o horario original,
      // "muda so o horario" mantem a data original (ver mergeDateTime). Se nem envolve
      // data/hora, NAO chama mergeDateTime -- ele reconstroi a string via Date, o que
      // reformataria um horario que o usuario nem pediu pra mudar.
      if (hasDateTimeChange) proposed.start = mergeDateTime(event.start, interpretation.new_date, interpretation.new_time);
      if (interpretation.new_title) proposed.title = interpretation.new_title;
      if (interpretation.new_reminder_minutes !== undefined) proposed.reminderMinutes = interpretation.new_reminder_minutes;
      if (interpretation.clear_location) proposed.location = null;
      else if (newLocation) proposed.location = newLocation;
      // horario final vence a duracao (RN01); sem nenhum dos dois a duracao original acompanha o inicio
      const endSpec: EndSpec | null = endTime ? { endTime: endTime.padStart(5, "0") } : duration !== undefined ? { durationMinutes: duration } : null;
      const end = computeProposedEnd(previous, proposed.start, endSpec);
      if (!end.ok) {
        logActivity(from, "edit_event", end.error);
        await sendText(from, end.error);
        break;
      }
      proposed.end = end.end;

      const changes = eventChanges(previous, proposed, endSpec);
      if (changes.length === 0) {
        logActivity(from, "edit_event", `pedido sem nenhuma mudanca real em "${event.title}"`);
        await sendText(from, NO_CHANGE_TEXT);
        break;
      }
      const changeText = eventChangeText(changes);
      const pendingEvent = {
        eventId: event.id,
        title: event.title,
        previous,
        proposed,
        endSpec,
        changeText,
        awaitingCorrection: false,
        correctionStage: "pick" as const,
        correctionTarget: null,
        headerText: eventHeader(event),
      };
      clearEditConfirmations(from);
      setPendingEditEvent(from, pendingEvent);
      logActivity(from, "edit_event", `pediu confirmacao: "${event.title}" ${changeText}`);
      await sendText(from, buildEventPreview(pendingEvent));
      break;
    }
    case "add_event_reminder": {
      if (interpretation.minutes_before < 0 || interpretation.minutes_before > 43200) {
        await sendText(from, "A antecedência do aviso precisa ser entre 0 (na hora) e 30 dias antes.");
        break;
      }

      const eventId = await chooseTarget(from, "event", interpretation, interpretation.query, resolvedTargetId);
      if (eventId === null) break;
      const event = getEventById(from, eventId)!;
      const result = addEventExtraReminder(from, event.id, interpretation.minutes_before);
      if (!result.ok && result.reason === "duplicate") {
        await sendText(from, `"${event.title}" já tem um aviso de ${formatMinutesBefore(interpretation.minutes_before)} antes.`);
        break;
      }
      if (!result.ok && result.reason === "max_reached") {
        const current = listEventReminderMinutes(from, event.id).map(formatMinutesBefore).join(", ");
        await sendText(from, `"${event.title}" já tem o máximo de ${MAX_REMINDERS_PER_EVENT} avisos (${current}). Remova um antes de adicionar outro.`);
        break;
      }
      const allReminders = listEventReminderMinutes(from, event.id).map(formatMinutesBefore).join(", ");
      logActivity(from, "add_event_reminder", `"${event.title}" +${formatMinutesBefore(interpretation.minutes_before)} antes`);
      await sendText(from, `🔔 Adicionado! "${event.title}" agora avisa: ${allReminders}.`);
      break;
    }
    case "remove_event_reminder": {

      const eventId = await chooseTarget(from, "event", interpretation, interpretation.query, resolvedTargetId);
      if (eventId === null) break;
      const event = getEventById(from, eventId)!;
      const result = removeEventReminder(from, event.id, interpretation.minutes_before);
      if (!result.ok && result.reason === "not_found") {
        const current = listEventReminderMinutes(from, event.id).map(formatMinutesBefore).join(", ");
        await sendText(from, `"${event.title}" não tem um aviso de ${formatMinutesBefore(interpretation.minutes_before)} antes. Os avisos dele hoje são: ${current}.`);
        break;
      }
      if (!result.ok && result.reason === "last_one") {
        await sendText(from, `"${event.title}" só tem esse aviso — todo evento precisa ficar com pelo menos 1. Se quiser trocar, peça pra mudar em vez de remover.`);
        break;
      }
      const allReminders = listEventReminderMinutes(from, event.id).map(formatMinutesBefore).join(", ");
      logActivity(from, "remove_event_reminder", `"${event.title}" -${formatMinutesBefore(interpretation.minutes_before)} antes`);
      await sendText(from, `🔕 Removido! "${event.title}" agora avisa: ${allReminders}.`);
      break;
    }
    case "reminder": {
      // due_at as vezes vem vazio/malformado quando a IA tenta preencher tanto
      // due_at quanto advance_minutes ao mesmo tempo (caso raro ja visto na
      // verificacao) -- sem essa guarda, ensureBrazilOffset quebraria em cima
      // de um valor invalido em vez de so pedir de novo.
      if (interpretation.advance_minutes && !interpretation.due_at) {
        await sendText(from, "Não entendi direito pra quando é o lembrete. Me diga o dia e o horário de novo, junto com a antecedência do aviso.");
        break;
      }
      if (interpretation.advance_minutes) {
        const dueAt = ensureBrazilOffset(interpretation.due_at);
        setPendingReminderAdvanceChoice(from, {
          message: interpretation.message,
          dueAt,
          advanceMinutes: interpretation.advance_minutes,
        });
        logActivity(from, "reminder", `pediu aviso antecipado (${interpretation.advance_minutes} min) pra "${interpretation.message}" -- lembrete simples nao suporta, perguntando`);
        await sendText(
          from,
          `⏰ Lembrete avisa exatamente na hora marcada, sem antecedência — não dá pra avisar ${interpretation.advance_minutes} min antes de um lembrete simples.\n\nQuer que eu crie "${interpretation.message}" como um EVENTO na agenda em vez disso (aí sim funciona o aviso antecipado), ou prefere que eu explique como fazer isso você mesmo? Responde "evento" ou "explica".`
        );
        break;
      }
      await createReminderAndNotify(from, { message: interpretation.message, due_at: interpretation.due_at });
      break;
    }
    case "delete_reminder": {
      const reminderId = await chooseTarget(from, "reminder", interpretation, interpretation.query, resolvedTargetId);
      if (reminderId === null) break;
      const reminder = getReminderById(from, reminderId)!;
      setPendingReminderDeletion(from, reminder.id, reminder.message);
      logActivity(from, "delete_reminder", `pediu confirmacao pra apagar "${reminder.message}"`);
      await sendText(
        from,
        `Encontrei o lembrete "${reminder.message}" pra ${formatDateTime(reminder.due_at)}. Confirma que quer apagar? Responde "sim" ou "não".`
      );
      break;
    }
    case "edit_reminder": {
      const hasDateTimeChange = Boolean(interpretation.new_date || interpretation.new_time);

      // RN17: o lembrete ja tocou (nao ha nenhum pendente com esse texto) -- edita nao adianta, adiar sim
      if (interpretation.query && resolvedTargetId === undefined && findPendingRemindersByText(from, interpretation.query).length === 0) {
        const played = findRecentSentReminders(from, interpretation.query, 24, 1)[0];
        if (played) {
          logActivity(from, "edit_reminder", `"${played.message}" ja tocou -- sugeriu adiar`);
          await sendText(from, formatAlreadyPlayed(played.message, played.due_at));
          break;
        }
      }
      const reminderId = await chooseTarget(from, "reminder", interpretation, interpretation.query, resolvedTargetId);
      if (reminderId === null) break;
      // RN01: sem mudanca explicita abre o menu de campos
      if (!hasDateTimeChange && !interpretation.new_message) {
        await openFieldMenu(from, "reminder", reminderId);
        break;
      }
      const reminder = getReminderById(from, reminderId)!;
      // so chama mergeDateTime quando a edicao realmente envolve data/hora --
      // ele reconstroi a string via Date, o que reformataria um horario que o
      // usuario nem pediu pra mudar (mesmo cuidado do edit_event acima).
      const newDueAt = hasDateTimeChange ? mergeDateTime(reminder.due_at, interpretation.new_date, interpretation.new_time) : reminder.due_at;
      const proposedMessage = interpretation.new_message ?? reminder.message;

      const dueChanged = hasDateTimeChange && new Date(newDueAt).getTime() !== new Date(reminder.due_at).getTime();
      const messageChanged = proposedMessage !== reminder.message;
      if (!dueChanged && !messageChanged) {
        logActivity(from, "edit_reminder", `pedido sem nenhuma mudanca real em "${reminder.message}"`);
        await sendText(from, NO_CHANGE_TEXT);
        break;
      }

      const changeParts: string[] = [];
      if (dueChanged) changeParts.push(`de ${formatDateTime(reminder.due_at)} pra ${formatDateTime(newDueAt)}`);
      if (messageChanged) changeParts.push(`texto "${reminder.message}" → "${proposedMessage}"`);
      const changeText = changeParts.join("; ");

      const pendingReminder = {
        reminderId: reminder.id,
        message: reminder.message,
        previousDueAt: reminder.due_at,
        proposedMessage,
        proposedDueAt: newDueAt,
        isDateTimeChange: dueChanged,
        changeText,
        awaitingCorrection: false,
        correctionStage: "pick" as const,
        correctionTarget: null,
        headerText: reminder.message,
      };
      clearEditConfirmations(from);
      setPendingEditReminder(from, pendingReminder);
      logActivity(from, "edit_reminder", `pediu confirmacao: "${reminder.message}" ${changeText}`);
      await sendText(from, buildReminderPreview(pendingReminder));
      break;
    }
    case "snooze_reminder": {
      const query = interpretation.query?.trim() || undefined;
      // com texto: se nenhum lembrete que tocou bate, explica o porque (ainda pendente / nao achei)
      if (resolvedTargetId === undefined && query && findRecentSentReminders(from, query, 24, 1).length === 0) {
        const notPlayed = findPendingRemindersByText(from, query)[0];
        logActivity(from, "snooze_reminder", notPlayed ? `"${notPlayed.message}" ainda nao tocou` : `nenhum lembrete que tocou bate com "${query}"`);
        await sendText(from, notPlayed ? formatNotPlayedYet(notPlayed.message, notPlayed.due_at, query) : SNOOZE_NOT_FOUND_TEXT);
        break;
      }
      const reminderId = await chooseTarget(from, "reminder_sent", interpretation, query, resolvedTargetId);
      if (reminderId === null) break;
      const reminder = getReminderById(from, reminderId)!;
      const now = new Date();
      const due = computeSnoozeDue(reminder.due_at, { minutes: interpretation.minutes, newDate: interpretation.new_date, newTime: interpretation.new_time }, now);
      if (!due.ok) {
        logActivity(from, "snooze_reminder", due.error);
        await sendText(from, due.error);
        break;
      }
      // adiar e direto (pedido explicito, baixo risco, com desfazer): novo horario e volta a "nao enviado"
      rescheduleReminder(from, reminder.id, due.dueAt, 0);
      setPendingUndo(from, {
        kind: "restore_reminder_snooze",
        reminderId: reminder.id,
        previousDueAt: reminder.due_at,
        previousSent: reminder.sent ? 1 : 0,
        description: reminder.message,
      });
      const usesMinutes = !interpretation.new_date && !interpretation.new_time;
      logActivity(from, "snooze_reminder", `"${reminder.message}" adiado pra ${due.dueAt}`);
      await sendText(from, formatSnoozeConfirmation(reminder.message, due.dueAt, usesMinutes ? interpretation.minutes : undefined, now));
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
      // pedido generico tipo "ativa o relatorio semanal", sem citar um dia --
      // antes disso caia num beco sem saida ("nao entendi o dia" e nada mais
      // acontecia, sem nem perguntar de novo). Um dia padrao (segunda) deixa o
      // pedido generico funcionar de primeira; se o usuario CITOU um dia mas a
      // IA nao reconheceu (nao deveria acontecer, o enum ja restringe), ainda
      // avisa e pede pra tentar de novo.
      if (interpretation.day_of_week && dayMap[interpretation.day_of_week] === undefined) {
        await sendText(from, "Não entendi o dia. Pode ser: domingo, segunda, terça, quarta, quinta, sexta ou sábado.");
        break;
      }
      const dayLabel = interpretation.day_of_week ?? "sexta";
      setReportDayOfWeek(from, dayMap[dayLabel]);
      logActivity(from, "set_report_day", `relatorio semanal agora chega toda(o) ${dayLabel}${interpretation.day_of_week ? "" : " (padrao)"}`);
      await sendText(
        from,
        interpretation.day_of_week
          ? `✅ Combinado! Vou te mandar o relatório de gastos da semana toda ${dayLabel} de manhã, e o relatório do mês no último dia de cada mês às 18h.`
          : `✅ Relatório semanal ativado! Vou te mandar toda sexta-feira às 9h (pode pedir pra eu mudar o dia quando quiser, ex: "quero receber toda quarta"), e o relatório do mês no último dia de cada mês às 18h.`
      );
      break;
    }
    case "set_no_expense_reminder": {
      let time: string | undefined;
      if (interpretation.time !== undefined) {
        const parsed = parseReminderTime(interpretation.time);
        if (!parsed) {
          await sendText(from, 'Não entendi o horário. Manda no formato 24h, tipo "18:30".');
          break;
        }
        time = parsed;
      }

      if (time) setNoExpenseReminderTime(from, time);
      // mudar so o horario ja implica querer o aviso ativado, a nao ser que o
      // usuario tambem tenha pedido pra desativar na mesma frase.
      if (interpretation.enabled !== undefined) setNoExpenseReminderEnabled(from, interpretation.enabled);
      else if (time) setNoExpenseReminderEnabled(from, true);

      const settings = getNoExpenseReminderSettings(from);
      logActivity(
        from,
        "set_no_expense_reminder",
        `aviso de gasto pendente ${settings.enabled ? `ativado (${settings.time})` : "desativado"}`
      );
      await sendText(
        from,
        settings.enabled
          ? `🔔 Combinado! Se você não registrar nenhum gasto até ${settings.time}, eu te aviso.`
          : "🔕 Combinado, não vou mais te avisar se você não registrar nenhum gasto no dia."
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
    case "delete_category": {
      const category = findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category);
      if (!category) {
        logActivity(from, "delete_category", `categoria "${interpretation.category}" nao encontrada`);
        await sendText(from, `Não achei uma categoria parecida com "${interpretation.category}".`);
        break;
      }
      const items = getExpensesByCategoryId(from, category.id);
      setPendingDeleteCategory(from, { categoryId: category.id, categoryName: category.name, expenseIds: items.map((i) => i.id) });
      logActivity(from, "delete_category", `pediu confirmacao: "${category.name}" (${items.length} gasto(s))`);
      await sendText(
        from,
        `Confirma que quer apagar a categoria "${category.name}"? ${items.length ? `Os ${items.length} gasto(s) dela ficam sem categoria (não são apagados). ` : ""}Responde "sim" ou "não".`
      );
      break;
    }
    case "rename_category": {
      const category = findCategoryByName(from, interpretation.category) ?? findCategoryMentionedIn(from, interpretation.category);
      if (!category) {
        logActivity(from, "rename_category", `categoria "${interpretation.category}" nao encontrada`);
        await sendText(from, `Não achei uma categoria parecida com "${interpretation.category}".`);
        break;
      }
      const newName = interpretation.new_name.trim();
      if (!newName) {
        await sendText(from, "Não entendi o novo nome. Me diga como quer chamar a categoria.");
        break;
      }
      renameCategory(from, category.id, newName);
      logActivity(from, "rename_category", `"${category.name}" -> "${newName}"`);
      await sendText(from, `✏️ Categoria "${category.name}" renomeada pra "${newName}".`);
      break;
    }
    case "rename_payment_method": {
      const method = findPaymentMethodByName(from, interpretation.payment_method) ?? findPaymentMethodMentionedIn(from, interpretation.payment_method);
      if (!method) {
        logActivity(from, "rename_payment_method", `forma de pagamento "${interpretation.payment_method}" nao encontrada`);
        await sendText(from, `Não achei uma forma de pagamento parecida com "${interpretation.payment_method}".`);
        break;
      }
      const newName = interpretation.new_name.trim();
      if (!newName) {
        await sendText(from, "Não entendi o novo nome. Me diga como quer chamar a forma de pagamento.");
        break;
      }
      renamePaymentMethod(from, method.id, newName);
      logActivity(from, "rename_payment_method", `"${method.name}" -> "${newName}"`);
      await sendText(from, `✏️ Forma de pagamento "${method.name}" renomeada pra "${newName}".`);
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
      const hasDateRange = Boolean(interpretation.date_start && interpretation.date_end);
      if (!hasDateRange && interpretation.days && interpretation.days > 1) {
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
      const noDaySpecified = !interpretation.date && !interpretation.days && !hasDateRange;
      if (noDaySpecified) {
        await sendText(
          from,
          `Você não disse o dia, então vou te mostrar as compras de hoje. Se quiser outro dia, é só especificar, ex: "editar compras de ontem" ou "gastos do dia 20".`
        );
      }

      const range = hasDateRange
        ? {
            start: interpretation.date_start!.slice(0, 10),
            end: addOneDayToDateString(interpretation.date_end!),
            label: `${formatDateOnly(interpretation.date_start!)} a ${formatDateOnly(interpretation.date_end!)}`,
          }
        : interpretation.date
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

      setLastShownExpenses(from, items.map((item) => item.id), range.label);
      if (hasDateRange) {
        // intervalo de varios dias: sempre detalhado, separado por dia, ja com o total
        logActivity(from, "list_expenses", `${items.length} gasto(s) em ${range.label} (detalhado)`);
        await sendText(from, buildGroupedExpenseListText(items, range.label));
        break;
      }
      const lines = items.map((item, idx) => {
        const details = [item.category ?? "sem categoria", item.payment_method].filter(Boolean).join(", ");
        return `${idx + 1}. R$${item.amount.toFixed(2)} — ${item.description} (${details}) — ${formatDateOnly(item.date)}`;
      });
      logActivity(from, "list_expenses", `${items.length} gasto(s) em ${range.label}`);
      await sendText(
        from,
        `🧾 Gastos — ${range.label}\n\n${lines.join("\n")}\n\n💰 Total: R$${items.reduce((sum, i) => sum + i.amount, 0).toFixed(2)}\n\nPra editar um, é só dizer, ex: "muda o valor do 2 pra 45" ou "o 2 foi no pix".`
      );
      break;
    }
    case "delete_expense": {
      let expense: ExpenseRecord | null;
      if (resolvedTargetId !== undefined || !interpretation.list_ref) {
        const expenseId = await chooseTarget(from, "expense", interpretation, interpretation.query, resolvedTargetId);
        if (expenseId === null) break;
        expense = getExpenseById(from, expenseId)!;
      } else {
        const ids = getLastShownExpenses(from);
        if (ids === null) {
          // RN07: lista expirada -- nunca aplica o numero a outra lista
          await offerRecentExpensesForExpiredList(from, interpretation);
          break;
        }
        const id = ids[interpretation.list_ref - 1];
        expense = id ? getExpenseById(from, id) : null;
        if (!expense) {
          await sendText(from, `Não sei a que gasto o número "${interpretation.list_ref}" se refere. Me pede a lista de novo, ex: "gastos de hoje".`);
          break;
        }
      }
      // gasto ja escolhido de uma lista (por numero ou depois de "qual deles?") nao oferece de novo "outro?"
      const explicitTarget = resolvedTargetId !== undefined || Boolean(interpretation.list_ref) || Boolean(interpretation.query);
      const category = expense.category_id ? getCategoryById(from, expense.category_id) : null;
      setPendingDeleteExpense(from, {
        expenseId: expense.id,
        amount: expense.amount,
        description: expense.description,
        date: expense.date,
        categoryId: expense.category_id,
        categoryName: category?.name ?? null,
        paymentMethodId: expense.payment_method_id,
        offerChoices: !explicitTarget,
      });
      logActivity(from, "delete_expense", `pediu confirmacao: #${expense.id} R$${expense.amount.toFixed(2)} — ${expense.description}`);
      const installmentGroup = findInstallmentGroup(from, expense.id);
      if (installmentGroup) {
        const baseName = expense.description.replace(/ \(parcela \d+\/\d+\)$/, "");
        const total = installmentGroup.reduce((sum, e) => sum + e.amount, 0);
        await sendText(
          from,
          `Essa é uma compra parcelada: "${baseName}" em ${installmentGroup.length}x (total R$${total.toFixed(2)}). Confirma que quer apagar TODAS as ${installmentGroup.length} parcelas? Responde "sim" ou "não".`
        );
        break;
      }
      await sendText(
        from,
        `Confirma que quer apagar este gasto? R$${expense.amount.toFixed(2)} — ${expense.description} (${category?.name ?? "sem categoria"}, ${formatDateOnly(expense.date)}). ${
          explicitTarget ? 'Responde "sim" ou "não".' : 'Responde "sim", ou "não" se for outro (aí te mostro os últimos pra você escolher).'
        }`
      );
      break;
    }
    case "total_last_list": {
      const ids = getLastShownExpenses(from);
      if (!ids?.length) {
        logActivity(from, "total_last_list", "sem lista recente");
        await sendText(from, 'Não tenho uma lista de gastos recente pra somar. Me pede primeiro, ex: "gastos de hoje", ou pergunta direto "quanto gastei essa semana".');
        break;
      }
      const shown = ids.map((id) => getExpenseById(from, id)).filter((e): e is ExpenseRecord => e !== null);
      const total = shown.reduce((sum, e) => sum + e.amount, 0);
      const label = getLastShownLabel(from);
      logActivity(from, "total_last_list", `R$${total.toFixed(2)} em ${shown.length} gasto(s)`);
      await sendText(from, `💰 Total${label ? ` (${label})` : ""}: R$${total.toFixed(2)} em ${shown.length} gasto(s).`);
      break;
    }
    case "edit_expense": {
      const rawChanges = normalizeExpenseChanges(interpretation);
      const problem = earlyEditError(rawChanges);
      if (problem) {
        await sendText(from, problem);
        break;
      }
      // sem dizer o que mudar nem qual gasto ("editar gasto"): lista os gastos pra escolher
      if (rawChanges.length === 0 && !interpretation.list_ref && !interpretation.query && resolvedTargetId === undefined) {
        await offerBrowseList(from, "expense");
        break;
      }
      const expense = await resolveEditExpenseTarget(from, interpretation, resolvedTargetId);
      if (!expense) break;
      // RN01: sem mudanca explicita abre o menu de campos
      if (rawChanges.length === 0) {
        await openFieldMenu(from, "expense", expense.id);
        break;
      }
      await startExpenseEdits(from, [{ expense, rawChanges }]);
      break;
    }
    case "set_recurring_expense": {
      if (interpretation.day_of_month < 1 || interpretation.day_of_month > 31) {
        await sendText(from, `O dia do mês precisa ser entre 1 e 31. "${interpretation.day_of_month}" não é um dia válido.`);
        break;
      }
      const category = getOrCreateCategory(from, interpretation.category);
      const paymentMethod = autoResolvePaymentMethod(from, interpretation.payment_method);
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
      await sendText(
        from,
        `🔁 Seus gastos fixos:\n\n${lines}\n\nPra editar um, é só dizer, ex: "muda o valor do gasto fixo da internet pra 120". Pra parar de lançar, ex: "cancela o gasto fixo da internet".`
      );
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
    case "edit_recurring_expense": {
      if (interpretation.new_day_of_month !== undefined && (interpretation.new_day_of_month < 1 || interpretation.new_day_of_month > 31)) {
        await sendText(from, `O dia do mês precisa ser entre 1 e 31. "${interpretation.new_day_of_month}" não é um dia válido.`);
        break;
      }
      if (interpretation.new_amount !== undefined) {
        const check = validateAmount(interpretation.new_amount);
        if (!check.ok) {
          await sendText(from, check.message);
          break;
        }
      }
      const recurringId = await chooseTarget(from, "recurring", interpretation, interpretation.query, resolvedTargetId);
      if (recurringId === null) break;
      const recurring = getRecurringExpenseById(from, recurringId)!;
      const hasAnyChange =
        interpretation.new_description !== undefined ||
        interpretation.new_amount !== undefined ||
        interpretation.new_category !== undefined ||
        interpretation.new_day_of_month !== undefined ||
        interpretation.new_payment_method !== undefined;
      // RN01: sem mudanca explicita abre o menu de campos
      if (!hasAnyChange) {
        await openFieldMenu(from, "recurring", recurring.id);
        break;
      }

      const previous: RecurringExpenseParams = {
        description: recurring.description,
        amount: recurring.amount,
        categoryId: recurring.category_id,
        paymentMethodId: recurring.payment_method_id,
        dayOfMonth: recurring.day_of_month,
      };
      const proposedParams: RecurringExpenseParams = { ...previous };
      // RN07: categoria / forma de pagamento que ainda nao existem so sao criadas no "1"
      let newCategoryName: string | null = null;
      let newPaymentMethodName: string | null = null;

      if (interpretation.new_description) proposedParams.description = interpretation.new_description.trim();
      if (interpretation.new_amount !== undefined) proposedParams.amount = interpretation.new_amount;
      if (interpretation.new_category) {
        const found = findCategoryByName(from, interpretation.new_category);
        if (found) proposedParams.categoryId = found.id;
        else newCategoryName = interpretation.new_category.trim();
      }
      if (interpretation.new_day_of_month !== undefined) proposedParams.dayOfMonth = interpretation.new_day_of_month;
      if (interpretation.new_payment_method) {
        const found = findPaymentMethodByName(from, interpretation.new_payment_method);
        if (found) proposedParams.paymentMethodId = found.id;
        else newPaymentMethodName = interpretation.new_payment_method.trim();
      }

      const changeText = buildRecurringChangeText(from, { previous, proposedParams, newCategoryName, newPaymentMethodName });
      if (!changeText) {
        logActivity(from, "edit_recurring_expense", `pedido sem nenhuma mudanca real em "${recurring.description}"`);
        await sendText(from, NO_CHANGE_TEXT);
        break;
      }
      const pendingRecurring = {
        recurringId: recurring.id,
        previous,
        proposedParams,
        newCategoryName,
        newPaymentMethodName,
        changeText,
        awaitingCorrection: false,
        headerText: recurringHeader({ description: previous.description, amount: previous.amount, dayOfMonth: previous.dayOfMonth }),
      };
      clearEditConfirmations(from);
      setPendingEditRecurring(from, pendingRecurring);
      logActivity(from, "edit_recurring_expense", `pediu confirmacao: "${recurring.description}": ${changeText}`);
      await sendText(from, buildRecurringPreview(from, pendingRecurring));
      break;
    }
    case "set_bill_alert": {
      const hasDayOfMonth = typeof interpretation.day_of_month === "number";
      const hasInterval = typeof interpretation.interval_days === "number";

      if (!hasDayOfMonth && !hasInterval) {
        await sendText(
          from,
          `Não entendi a recorrência de "${interpretation.description}". Pode ser um dia fixo do mês (ex: "todo dia 10") ou um intervalo (ex: "a cada 45 dias")?`
        );
        break;
      }
      if (hasDayOfMonth && (interpretation.day_of_month! < 1 || interpretation.day_of_month! > 31)) {
        await sendText(from, `O dia do mês precisa ser entre 1 e 31. "${interpretation.day_of_month}" não é um dia válido.`);
        break;
      }
      if (hasInterval && interpretation.interval_days! < 1) {
        await sendText(from, `O intervalo precisa ser de pelo menos 1 dia.`);
        break;
      }

      createBillAlert(
        hasDayOfMonth
          ? { fromNumber: from, name: interpretation.description, dayOfMonth: interpretation.day_of_month! }
          : { fromNumber: from, name: interpretation.description, intervalDays: interpretation.interval_days! }
      );
      const recurrenceLabel = hasDayOfMonth ? `todo dia ${interpretation.day_of_month}` : `a cada ${interpretation.interval_days} dias`;
      logActivity(from, "set_bill_alert", `${interpretation.description}, ${recurrenceLabel}`);
      await sendText(
        from,
        `📌 Alerta cadastrado: ${recurrenceLabel} eu te pergunto se já fez "${interpretation.description}". Se ainda não tiver feito, é só pedir pra eu lembrar de novo no dia seguinte.`
      );
      break;
    }
    case "list_bill_alerts": {
      const bills = listBillAlerts(from);
      logActivity(from, "list_bill_alerts", `${bills.length} alerta(s) cadastrado(s)`);
      if (!bills.length) {
        await sendText(
          from,
          "Você ainda não tem nenhum alerta cadastrado. Pode dizer algo como \"me lembra de pagar a conta de água todo dia 5\" ou \"me lembra de comprar ração a cada 45 dias\"."
        );
        break;
      }
      const lines = bills
        .map((b) => `• ${b.name} — ${b.recurrence_type === "interval" ? `a cada ${b.interval_days} dias` : `todo dia ${b.day_of_month}`}`)
        .join("\n");
      await sendText(from, `📌 Seus alertas:\n\n${lines}\n\nPra cancelar um, é só dizer, ex: "cancela o alerta da água".`);
      break;
    }
    case "edit_bill_alert": {
      const bill = findActiveBillAlertByName(from, interpretation.query);
      if (!bill) {
        logActivity(from, "edit_bill_alert", `nenhum alerta encontrado para "${interpretation.query}"`);
        await sendText(from, `Não achei nenhum alerta parecido com "${interpretation.query}".`);
        break;
      }
      const newName = interpretation.new_name?.trim() || undefined;
      const dayOfMonth = interpretation.day_of_month;
      const intervalDays = interpretation.interval_days;
      if (dayOfMonth !== undefined && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
        await sendText(from, "O dia do mês precisa ser um número de 1 a 31.");
        break;
      }
      if (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650)) {
        await sendText(from, "O intervalo precisa ser um número de dias entre 1 e 3650.");
        break;
      }
      if (!newName && dayOfMonth === undefined && intervalDays === undefined) {
        await sendText(from, `O que você quer mudar em "${bill.name}"? Pode ser o nome, o dia do mês ou o intervalo de dias, ex: "muda o alerta da água pro dia 8".`);
        break;
      }
      const updated = updateBillAlert(from, bill.id, { name: newName, dayOfMonth, intervalDays });
      if (!updated) {
        await sendText(from, `Não consegui editar "${bill.name}".`);
        break;
      }
      const recurrenceLabel = updated.recurrence_type === "interval" ? `a cada ${updated.interval_days} dias` : `todo dia ${updated.day_of_month}`;
      logActivity(from, "edit_bill_alert", `"${bill.name}" -> "${updated.name}", ${recurrenceLabel}`);
      await sendText(from, `✏️ Alerta atualizado: "${updated.name}" — ${recurrenceLabel}.`);
      break;
    }
    case "remove_bill_alert": {
      const bill = findActiveBillAlertByName(from, interpretation.query);
      if (!bill) {
        logActivity(from, "remove_bill_alert", `nenhum alerta encontrado para "${interpretation.query}"`);
        await sendText(from, `Não achei nenhum alerta parecido com "${interpretation.query}".`);
        break;
      }
      setPendingRemoveBillAlert(from, {
        billAlertId: bill.id,
        name: bill.name,
        recurrenceType: bill.recurrence_type,
        dayOfMonth: bill.day_of_month,
        intervalDays: bill.interval_days,
      });
      const recurrenceLabel = bill.recurrence_type === "interval" ? `a cada ${bill.interval_days} dias` : `todo dia ${bill.day_of_month}`;
      logActivity(from, "remove_bill_alert", `pediu confirmacao pra remover "${bill.name}"`);
      await sendText(from, `Vou parar de te perguntar sobre "${bill.name}" (${recurrenceLabel}). Confirma? Responde "sim" ou "não".`);
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
    case "list_incomes": {
      const range = interpretation.days
        ? lastNDaysRange(interpretation.days)
        : interpretation.period === "week"
          ? currentWeekRange()
          : currentMonthRange();
      const all = listIncomesBetween(from, range.start, range.end);
      if (!all.length) {
        logActivity(from, "list_incomes", `nenhuma entrada em ${range.label}`);
        await sendText(from, `💵 Entradas — ${range.label}\n\nNenhuma entrada registrada nesse período.`);
        break;
      }
      const shown = all.slice(0, MAX_INCOME_LIST);
      const summary = getIncomeSummaryBetween(range.start, range.end, from);
      setLastShownIncomes(from, shown.map((i) => i.id), range.label);
      logActivity(from, "list_incomes", `${all.length} entrada(s) em ${range.label}`);
      await sendText(
        from,
        formatIncomeList({ label: range.label, items: shown, total: summary.total, totalCount: all.length, dashboardUrl: config.dashboardUrl })
      );
      break;
    }
    case "edit_income": {
      const rawChanges = normalizeIncomeChanges(interpretation);
      const problem = earlyEditError(rawChanges);
      if (problem) {
        await sendText(from, problem);
        break;
      }
      // sem dizer o que mudar nem qual entrada ("editar entrada"): lista as entradas pra escolher
      if (rawChanges.length === 0 && !interpretation.list_ref && !interpretation.query && resolvedTargetId === undefined) {
        await offerBrowseList(from, "income");
        break;
      }
      const income = await resolveIncomeTarget(from, interpretation, resolvedTargetId);
      if (!income) break;
      // sem mudanca explicita abre o menu de campos
      if (rawChanges.length === 0) {
        await openFieldMenu(from, "income", income.id);
        break;
      }
      await startIncomeEdit(from, income, rawChanges);
      break;
    }
    case "delete_income": {
      const income = await resolveIncomeTarget(from, interpretation, resolvedTargetId);
      if (!income) break;
      const snapshot = incomeParamsOf(income);
      clearEditConfirmations(from);
      setPendingDeleteIncome(from, { incomeId: income.id, snapshot });
      logActivity(from, "delete_income", `pediu confirmacao: #${income.id} ${income.description}`);
      await sendText(from, formatIncomeDeletePrompt(incomeHeader(snapshot)));
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
      // regra: gasto no Pix/dinheiro (e sem forma de pagamento) abate das entradas;
      // gasto no cartao so abate do limite do cartao (se o usuario informou um --
      // sem limite, nao mostra nada dele alem do quanto foi gasto no cartao)
      const bal = getRangeBalance(from, range.start, range.end);
      const balanceEmoji = bal.balance >= 0 ? "✅" : "🔻";
      const cardLines =
        bal.spentCard > 0 || bal.cards.length
          ? `

💳 No cartão: R$${bal.spentCard.toFixed(2)} (não abate do saldo)` +
            bal.cards.map((c) => `
   • ${c.name}: limite disponível R$${c.available.toFixed(2)} de R$${c.limit.toFixed(2)}`).join("")
          : "";
      logActivity(from, "balance", `${range.label}: entradas R$${bal.incomeTotal.toFixed(2)}, gastos (pix/dinheiro) R$${bal.spentNonCard.toFixed(2)}, saldo R$${bal.balance.toFixed(2)}`);
      await sendText(
        from,
        `📊 Saldo — ${range.label}

💵 Entradas: R$${bal.incomeTotal.toFixed(2)}
💰 Gastos (Pix/dinheiro): R$${bal.spentNonCard.toFixed(2)}
${balanceEmoji} Saldo: R$${bal.balance.toFixed(2)}${cardLines}`
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
        case "delete_expenses_batch":
          for (const expenseId of undo.expenseIds) deleteExpense(from, expenseId);
          logActivity(from, "undo", `lote de gastos removido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz os ${undo.expenseIds.length} gastos: ${undo.description}.`);
          break;
        case "recreate_expenses":
          withTransaction(() => {
            for (const item of undo.items) insertExpense(item);
          });
          logActivity(from, "undo", `compra parcelada recriada: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, ${undo.description} voltou.`);
          break;
        case "recreate_expense":
          insertExpense(undo.params);
          logActivity(from, "undo", `gasto recriado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o gasto ${undo.description} voltou.`);
          break;
        case "restore_expense":
          updateExpense(from, undo.expenseId, undo.previous);
          logActivity(from, "undo", `gasto revertido: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz a última alteração em "${undo.description}".`);
          break;
        case "restore_expenses_batch": {
          const missing: string[] = [];
          let restored = 0;
          withTransaction(() => {
            for (const item of undo.items) {
              if (!getExpenseById(from, item.expenseId)) {
                missing.push(item.description);
                continue;
              }
              updateExpense(from, item.expenseId, item.previous);
              restored++;
            }
          });
          logActivity(from, "undo", `edicao em lote desfeita: ${undo.description}`);
          await sendText(
            from,
            `↩️ Prontinho, desfiz as alterações em ${restored} gasto(s).${missing.length ? ` Não achei mais: ${missing.map((m) => `"${m}"`).join(", ")}.` : ""}`
          );
          break;
        }
        case "restore_category":
          updateExpenseCategory(from, undo.expenseId, undo.previousCategoryId);
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
        case "recreate_reminder":
          createReminder(undo.params.toNumber, undo.params.message, undo.params.dueAt);
          logActivity(from, "undo", `lembrete recriado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o lembrete "${undo.description}" voltou.`);
          break;
        case "delete_income":
          deleteIncome(from, undo.incomeId);
          logActivity(from, "undo", `entrada removida: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz: entrada de ${undo.description} removida.`);
          break;
        case "restore_income":
          if (!updateIncome(from, undo.incomeId, undo.previous)) {
            await sendText(from, INCOME_GONE_TEXT);
            break;
          }
          logActivity(from, "undo", `entrada revertida: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz a última alteração na entrada "${undo.description}".`);
          break;
        case "recreate_income":
          insertIncome(undo.params);
          logActivity(from, "undo", `entrada recriada: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, a entrada "${undo.description}" voltou.`);
          break;
        case "bulk_restore_category":
          for (const change of undo.changes) updateExpenseCategory(from, change.expenseId, change.previousCategoryId);
          logActivity(from, "undo", `recategorizacao em lote desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz a mudança de categoria de ${undo.changes.length} gasto(s).`);
          break;
        case "undo_merge_categories": {
          // a categoria de origem foi apagada no merge -- recria pelo nome (fica
          // com um id novo, mas mesma funcao pro usuario) e move os gastos de volta
          const recreated = getOrCreateCategory(from, undo.sourceCategoryName);
          for (const expenseId of undo.expenseIds) updateExpenseCategory(from, expenseId, recreated.id);
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
          logActivity(from, "undo", `edicao de evento desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, "${undo.description}" voltou como estava antes.`);
          break;
        case "restore_reminder_time":
          updateReminder(from, undo.reminderId, { message: undo.description, dueAt: undo.previousDueAt });
          logActivity(from, "undo", `edicao de lembrete desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o lembrete "${undo.description}" voltou como estava antes.`);
          break;
        case "restore_reminder_snooze":
          rescheduleReminder(from, undo.reminderId, undo.previousDueAt, undo.previousSent);
          logActivity(from, "undo", `adiamento desfeito: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, desfiz o adiamento do lembrete "${undo.description}".`);
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
        case "restore_bill_alert":
          createBillAlert(undo.params);
          logActivity(from, "undo", `alerta de conta fixa recriado: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o alerta de "${undo.description}" voltou a ser perguntado todo mês.`);
          break;
        case "restore_recurring_expense_fields":
          updateRecurringExpense(from, undo.recurringId, undo.previous);
          logActivity(from, "undo", `edicao de gasto fixo desfeita: ${undo.description}`);
          await sendText(from, `↩️ Prontinho, o gasto fixo "${undo.description}" voltou como estava antes.`);
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

📌 *Alertas e lembretes recorrentes*
"Me lembra de pagar a conta de água todo dia 5" (dia fixo do mês) ou "me lembra de comprar ração a cada 45 dias" (intervalo) — eu não lanço nada sozinho, só pergunto na hora certa se já foi feito. Se ainda não, é só pedir pra eu lembrar de novo no dia seguinte.

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
