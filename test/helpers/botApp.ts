// App do bot "reiniciavel" pra testes funcionais: descarta os modulos de src (menos banco e config) e recarrega o
// router -- todo estado em memoria some, o SQLite continua --, simula o WhatsApp (sendText) e a IA (interpretText)
// e tem um relogio por teste (Date.now) que pode ser fixado e avancado.
import type { TestContext } from "node:test";
import path from "node:path";
import type { ClassifyReplyInput, Interpretation, ReplyClassification } from "../../src/ai/interpret";

export type Sent = { to: string; text: string };

export interface BotApp {
  handle: (data: unknown) => Promise<void>;
  sent: Sent[];
  calls: string[]; // textos que chegaram na IA (interpretText)
  queueReply: (actions: Interpretation[]) => void;
  failNext: () => void;
  resetLimit: () => void;
  last: () => string;
  setNow: (ms: number | null) => void; // fixa o relogio (null = relogio real)
  advance: (ms: number) => void;
  // Card 24: a IA que escolhe a opcao de uma resposta livre (classifyReply). Sem nada na fila devolve 'nenhuma' (baixa); um Error simula a IA fora do ar.
  queueClassification: (result: ReplyClassification | Error) => void;
  classifyCalls: ClassifyReplyInput[];
}

interface Clock {
  fixed: number | null;
  original: () => number;
}
const clocks = new WeakMap<TestContext, Clock>();

function clockFor(t: TestContext): Clock {
  let clock = clocks.get(t);
  if (!clock) {
    const created: Clock = { fixed: null, original: Date.now.bind(Date) };
    clock = created;
    clocks.set(t, created);
    // um unico mock de Date.now por teste (mocks empilhados deixam o antigo valendo)
    t.mock.method(Date, "now", () => created.fixed ?? created.original());
  }
  return clock;
}

export function msg(from: string, text: string) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, id: `ba-${Math.random().toString(36).slice(2)}`, fromMe: false },
    messageType: "conversation" as const,
    message: { conversation: text },
  };
}

export function bootApp(t: TestContext, now?: number): BotApp {
  const clock = clockFor(t);
  if (now !== undefined) clock.fixed = now;
  const srcDir = path.join(__dirname, "..", "..", "src");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir) && !/[\\/](db|config)\.js$/.test(key)) delete require.cache[key];
  }
  const client = require("../../src/whatsapp/client");
  const ai = require("../../src/ai/interpret");
  const rateLimit = require("../../src/access/rateLimit");
  const router = require("../../src/router");
  rateLimit.resetRateLimitForTests();
  const sent: Sent[] = [];
  const calls: string[] = [];
  const queue: Interpretation[][] = [];
  let failing = false;
  const classifyQueue: (ReplyClassification | Error)[] = [];
  const classifyCalls: ClassifyReplyInput[] = [];
  t.mock.method(client, "sendText", async (to: string, text: string) => {
    sent.push({ to, text });
  });
  t.mock.method(ai, "interpretText", async (_from: string, text: string) => {
    calls.push(text);
    if (failing) {
      failing = false;
      throw new Error("IA fora do ar (simulado)");
    }
    return queue.shift() ?? [];
  });
  t.mock.method(ai, "classifyReply", async (input: ClassifyReplyInput) => {
    classifyCalls.push(input);
    const next = classifyQueue.shift();
    if (next instanceof Error) throw next;
    return next ?? { option: null, confidence: "baixa" };
  });
  return {
    handle: router.handleIncomingMessage,
    sent,
    calls,
    queueReply: (a) => queue.push(a),
    queueClassification: (result) => void classifyQueue.push(result),
    classifyCalls,
    failNext: () => {
      failing = true;
    },
    resetLimit: () => rateLimit.resetRateLimitForTests(),
    last: () => sent[sent.length - 1].text,
    setNow: (ms) => {
      clock.fixed = ms;
    },
    advance: (ms) => {
      clock.fixed = (clock.fixed ?? clock.original()) + ms;
    },
  };
}
