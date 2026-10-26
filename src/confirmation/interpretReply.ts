// Card 24: entender uma resposta livre ou falada dentro das opcoes de uma pergunta aberta. Nivel A (este arquivo, puro, sem IA): regra tolerante com
// vocabulario por intencao e lista de conflitos. Nivel B (IA restrita): ver interpretOpenReply. A leitura EXATA ("1", "sim", "ja paguei") continua
// sendo dos resolvedores originais; isto so roda depois que eles desistiram. Nada interpretado e aplicado sozinho (RN05): quem chama pede confirmacao.
import { classifyReply, type ClassifyReplyInput, type ReplyClassification } from "../ai/interpret";
import { normalizeReply } from "./normalize";
import type { ReplyIntent, ReplyOption, ReplyQuestion } from "./replyOptions";

// no maximo isso de palavras no Nivel A; frase longa e mais provavel de ter condicao, ressalva ou pedido novo
export const RULES_MAX_WORDS = 8;

// palavras que mudam o sentido de uma afirmacao (negacao, adiamento, condicao, duvida, outro item): com uma delas sobrando, nao ha sugestao
const CONFLICT_TOKENS = new Set(["nao", "nunca", "ainda", "depois", "amanha", "mas", "talvez", "vou", "quase", "so", "outro", "outra", "errado", "espera", "acho", "sera", "nem", "metade", "parte", "parcial", "parcialmente", "pouco", "meio", "falta", "faltou", "resto", "restante", "parcela"]);
const CONFLICT_PHRASES = ["mais tarde"];

const PAID: RegExp[] = [/\b(paguei|pago|quitei|quitado|resolvi|resolvido|fiz|feito|comprei)\b/, /\bja foi\b/];
const SNOOZE: RegExp[] = [/\bainda nao\b/, /\bme lembr[ae]\b/, /\blembr[ae]\b/, /\bamanha\b/, /\bmais tarde\b/, /\bdepois\b/];
const SKIP: RegExp[] = [/\bpular\b/, /\bpul[ae]\b/, /\bnao vou (pagar|fazer|comprar)\b/, /\b(esse|este) mes nao\b/];

const CONFIRM_PREVIEW: RegExp[] = [
  /\bpode (salvar|aplicar|confirmar|fazer|seguir|gravar|registrar|mandar)\b/,
  /\bconfirm(o|a|ar)\b/,
  /\bsalv(a|ar)\b/,
  /\baplic(a|ar)\b/,
  /\bisso( mesmo| ai)?\b/,
  /\bexat(o|amente)\b/,
  /\bcorret[oa]\b/,
  /\bcertinho\b/,
  /\bperfeito\b/,
  /\bmanda ver\b/,
];
const CORRECT: RegExp[] = [/\bcorrig(ir|e)\b/, /\bajust(ar|a)\b/, /\b(ta|esta) errado\b/, /\bquero (mudar|alterar|corrigir)\b/];
const CANCEL: RegExp[] = [/\bcancel(a|ar)\b/, /\bdeix(a|ar)( pra la)?\b/, /\besquece\b/, /\bdesist\w*\b/, /\bmelhor nao\b/, /\bnao quero\b/, /\bmant(er|em|enha)\b/];

// apagar/remover: "cancelar" aqui e desistir (3), exceto no evento, onde "cancelar o evento" e a confirmacao (1)
const CONFIRM_DELETE: RegExp[] = [
  /\bpode (apagar|excluir|remover|parar|juntar|mudar)\b/,
  /\bconfirm(o|a|ar)\b/,
  /\b(apaga|apagar|exclui|excluir|remove|remover|junta|juntar|pare|parar)\b/,
];
const CONFIRM_DELETE_EVENT: RegExp[] = [/\bpode (cancelar|apagar|excluir|remover)\b/, /\bcancel(a|ar) (o )?(evento|compromisso|reuniao)\b/, /\bconfirm(o|a|ar)\b/, /\b(apaga|apagar|exclui|excluir|remove|remover)\b/];
const CANCEL_DELETE_EVENT: RegExp[] = [/\bdeix(a|ar)( pra la)?\b/, /\besquece\b/, /\bdesist\w*\b/, /\bmelhor nao\b/, /\bnao quero\b/, /\bmant(er|em|enha)\b/];

function patternsFor(question: ReplyQuestion, intent: ReplyIntent): RegExp[] {
  switch (intent) {
    case "paid":
      return PAID;
    case "snooze":
      return SNOOZE;
    case "skip":
      return SKIP;
    case "correct":
      return CORRECT;
    case "confirm":
      if (question.kind === "delete_event") return CONFIRM_DELETE_EVENT;
      return question.kind === "delete" ? CONFIRM_DELETE : CONFIRM_PREVIEW;
    case "cancel":
      return question.kind === "delete_event" ? CANCEL_DELETE_EVENT : CANCEL;
    default:
      return []; // opcoes do cadastro ("lancar sozinho", "so avisar"...) e "outro item" ficam so com a IA
  }
}

// tira da frase tudo o que casou com o vocabulario da intencao; devolve o que sobrou, ou null se nada casou
function residualAfterIntent(normalized: string, patterns: RegExp[]): string | null {
  let residual = normalized;
  let matched = false;
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, "g");
    if (global.test(residual)) {
      matched = true;
      residual = residual.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return matched ? residual.replace(/\s+/g, " ").trim() : null;
}

function hasConflict(residual: string): boolean {
  if (CONFLICT_PHRASES.some((phrase) => residual.includes(phrase))) return true;
  return residual.split(" ").some((token) => CONFLICT_TOKENS.has(token));
}

// Nivel A: a opcao so e sugerida quando a frase tem ate 8 palavras, nenhum digito (valor, data ou hora embutidos sao correcao, nao resposta) e
// apenas UMA intencao das opcoes da pergunta casa SEM sobrar palavra de conflito. "nao, ja paguei" e "sim, mas so amanha" nunca viram "pago".
export function interpretReplyRules(text: string, question: ReplyQuestion): ReplyOption | null {
  if (/\d/.test(text)) return null;
  const normalized = normalizeReply(text);
  if (!normalized || normalized.split(" ").length > RULES_MAX_WORDS) return null;
  const candidates: ReplyOption[] = [];
  let matchedIntents = 0;
  for (const option of question.options) {
    const residual = residualAfterIntent(normalized, patternsFor(question, option.intent));
    if (residual === null) continue;
    matchedIntents++;
    if (!hasConflict(residual)) candidates.push(option);
  }
  // frase com vocabulario de duas opcoes ("ja paguei, me lembra amanha") e ambigua: nao sugere nada
  return candidates.length === 1 && matchedIntents === 1 ? candidates[0] : null;
}

export interface InterpretedReply {
  option: ReplyOption;
  level: "rules" | "ai";
}

// ---- Nivel B: IA restrita as opcoes (RN04, RN10) ----
// no maximo 3 chamadas por numero a cada 10 minutos (molde do takeSecondChance); passou disso, so o Nivel A
export const REPLY_AI_MAX_CALLS = 3;
export const REPLY_AI_WINDOW_MS = 10 * 60 * 1000;
// mensagem longa nao vai a IA (e quase sempre pedido novo, nao resposta)
export const REPLY_AI_MAX_CHARS = 200;

const aiCalls = new Map<string, number[]>();

// registra a chamada se ainda ha cota na janela; false = sem cota
export function takeReplyAiCall(from: string, now: number): boolean {
  const recent = (aiCalls.get(from) ?? []).filter((t) => now - t < REPLY_AI_WINDOW_MS);
  if (recent.length >= REPLY_AI_MAX_CALLS) {
    aiCalls.set(from, recent);
    return false;
  }
  recent.push(now);
  aiCalls.set(from, recent);
  return true;
}

export function resetReplyAiLimitForTests() {
  aiCalls.clear();
}

export interface ReplyAiDeps {
  classify?: (input: ClassifyReplyInput) => Promise<ReplyClassification>;
  now?: () => number;
}

// Pergunta a IA qual das opcoes a resposta diz. So conta como sugestao com confianca "alta" e uma opcao que EXISTE na pergunta; qualquer erro da IA
// vira "nao entendi" (null), nunca erro pro cliente.
export async function interpretReplyWithAi(from: string, text: string, question: ReplyQuestion, source: "audio" | "text", deps: ReplyAiDeps = {}): Promise<ReplyOption | null> {
  const clean = text.trim();
  if (!clean || clean.length > REPLY_AI_MAX_CHARS) return null;
  if (!takeReplyAiCall(from, (deps.now ?? Date.now)())) return null;
  try {
    const result = await (deps.classify ?? classifyReply)({
      questionText: question.text,
      options: question.options.map((o) => ({ number: o.number, label: o.label, destructive: o.destructive })),
      text: clean,
      fromAudio: source === "audio",
    });
    if (result.confidence !== "alta" || result.option === null) return null;
    return question.options.find((o) => o.number === result.option) ?? null;
  } catch (err) {
    console.error("Erro ao interpretar a resposta com a IA:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Ponto unico: Nivel A (regra tolerante, sem custo) e, se ele nao resolver, o Nivel B (IA restrita as opcoes). Devolve null quando nada foi entendido.
export async function interpretOpenReply(
  from: string,
  text: string,
  question: ReplyQuestion,
  source: "audio" | "text" = "text",
  deps: ReplyAiDeps = {}
): Promise<InterpretedReply | null> {
  const byRules = interpretReplyRules(text, question);
  if (byRules) return { option: byRules, level: "rules" };
  const byAi = await interpretReplyWithAi(from, text, question, source, deps);
  return byAi ? { option: byAi, level: "ai" } : null;
}
