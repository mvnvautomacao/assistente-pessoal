// Card 24, parte 2: Nivel B -- cota de chamadas, filtro de confianca/opcao e o parser da ferramenta classify_reply (com a rede simulada).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { classifyReply } from "../../src/ai/interpret";
import {
  interpretOpenReply,
  interpretReplyWithAi,
  REPLY_AI_MAX_CALLS,
  REPLY_AI_MAX_CHARS,
  REPLY_AI_WINDOW_MS,
  resetReplyAiLimitForTests,
  takeReplyAiCall,
} from "../../src/confirmation/interpretReply";
import { billReplyQuestion, deleteReplyQuestion } from "../../src/confirmation/replyOptions";

const bill = billReplyQuestion("Luz", "day_of_month", false);

const verdict = (option: 1 | 2 | 3 | null, confidence: "alta" | "baixa") => async () => ({ option, confidence });

test("takeReplyAiCall: 3 chamadas por numero em 10 minutos, janela deslizante, numeros independentes", () => {
  resetReplyAiLimitForTests();
  const t0 = 1_000_000;
  for (let i = 0; i < REPLY_AI_MAX_CALLS; i++) assert.equal(takeReplyAiCall("A", t0 + i), true);
  assert.equal(takeReplyAiCall("A", t0 + 5), false);
  assert.equal(takeReplyAiCall("B", t0 + 5), true, "outro numero tem a propria cota");
  assert.equal(takeReplyAiCall("A", t0 + REPLY_AI_WINDOW_MS - 1), false, "ainda dentro da janela");
  assert.equal(takeReplyAiCall("A", t0 + REPLY_AI_WINDOW_MS + 5), true, "a janela andou");
});

test("interpretReplyWithAi: so 'alta' com opcao existente vira sugestao; 'baixa', 'nenhuma', opcao fora da pergunta e erro viram null", async () => {
  resetReplyAiLimitForTests();
  assert.equal((await interpretReplyWithAi("A", "fechou", bill, "text", { classify: verdict(1, "alta") }))?.number, 1);
  assert.equal((await interpretReplyWithAi("A", "fechou", bill, "text", { classify: verdict(1, "baixa") })), null);
  assert.equal(await interpretReplyWithAi("A", "fechou", bill, "text", { classify: verdict(null, "alta") }), null);
  const delete13 = deleteReplyQuestion({ flow: "expense" });
  assert.equal(await interpretReplyWithAi("B", "pode ser a 2", delete13, "text", { classify: verdict(2, "alta") }), null, "a opcao 2 nao existe nessa pergunta");
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    assert.equal(
      await interpretReplyWithAi("C", "fechou", bill, "text", {
        classify: async () => {
          throw new Error("fora do ar");
        },
      }),
      null
    );
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});

test("interpretReplyWithAi: vazio, mais de 200 caracteres e sem cota nao chamam a IA; origem 'audio' vai no pedido", async () => {
  resetReplyAiLimitForTests();
  let calls = 0;
  const seen: { fromAudio: boolean; text: string }[] = [];
  const classify = async (input: { fromAudio: boolean; text: string }) => {
    calls++;
    seen.push({ fromAudio: input.fromAudio, text: input.text });
    return { option: 1 as const, confidence: "alta" as const };
  };
  assert.equal(await interpretReplyWithAi("A", "   ", bill, "text", { classify }), null);
  assert.equal(await interpretReplyWithAi("A", "x".repeat(REPLY_AI_MAX_CHARS + 1), bill, "text", { classify }), null);
  assert.equal(calls, 0);
  assert.ok(await interpretReplyWithAi("A", "  fechou ", bill, "audio", { classify }));
  assert.deepEqual(seen, [{ fromAudio: true, text: "fechou" }]);
  const t0 = 5_000_000;
  for (let i = 0; i < REPLY_AI_MAX_CALLS - 1; i++) await interpretReplyWithAi("A", `a ${i}`, bill, "text", { classify, now: () => t0 });
  assert.equal(await interpretReplyWithAi("A", "mais uma", bill, "text", { classify, now: () => t0 }), null, "sem cota");
  assert.equal(calls, REPLY_AI_MAX_CALLS);
});

test("interpretOpenReply: o Nivel A resolve sem gastar cota; sem vocabulario vai a IA (nivel 'ai')", async () => {
  resetReplyAiLimitForTests();
  let calls = 0;
  const classify = async () => {
    calls++;
    return { option: 2 as const, confidence: "alta" as const };
  };
  assert.deepEqual((await interpretOpenReply("A", "já paguei a conta hoje", bill, "text", { classify }))?.level, "rules");
  assert.equal(calls, 0);
  const viaAi = await interpretOpenReply("A", "fica pra outro dia, valeu", bill, "audio", { classify });
  assert.deepEqual([viaAi?.level, viaAi?.option.number], ["ai", 2]);
  assert.equal(calls, 1);
});

// servidor falso na porta de IA deste processo de teste (ver test/setup.ts): o cliente da Anthropic fala com ele em vez da rede
async function withFakeAi(handler: (body: Record<string, unknown>) => unknown, fn: () => Promise<void>) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const content = handler(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(Number(process.env.TEST_AI_PORT), "127.0.0.1", resolve));
  try {
    await fn();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("classifyReply: le a ferramenta (opcao 1/2/3 ou 'nenhuma', confianca) e cai em 'nenhuma/baixa' sem tool_use; o pedido leva as opcoes e a origem", async () => {
  const bodies: { messages: { content: string }[]; tool_choice: { name: string }; model: string; max_tokens: number }[] = [];
  let content: unknown[] = [];
  await withFakeAi(
    (body) => {
      bodies.push(body as (typeof bodies)[number]);
      return content;
    },
    async () => {
  const input = {
    questionText: "Aviso Luz",
    options: [
      { number: 1, label: "✅ Já paguei" },
      { number: 3, label: "⏭️ Pular", destructive: true },
    ],
    text: "fechou",
    fromAudio: true,
  };
  content = [{ type: "tool_use", id: "t1", name: "classify_reply", input: { option: "1", confidence: "alta" } }];
  assert.deepEqual(await classifyReply(input), { option: 1, confidence: "alta" });
  content = [{ type: "tool_use", id: "t1", name: "classify_reply", input: { option: "3", confidence: "baixa" } }];
  assert.deepEqual(await classifyReply(input), { option: 3, confidence: "baixa" });
  content = [{ type: "tool_use", id: "t1", name: "classify_reply", input: { option: "nenhuma", confidence: "alta" } }];
  assert.deepEqual(await classifyReply(input), { option: null, confidence: "alta" });
  content = [{ type: "tool_use", id: "t1", name: "classify_reply", input: { option: "9", confidence: "talvez" } }];
  assert.deepEqual(await classifyReply(input), { option: null, confidence: "baixa" });
  content = [{ type: "text", text: "nao sei" }];
  assert.deepEqual(await classifyReply(input), { option: null, confidence: "baixa" });
  assert.equal(bodies[0].tool_choice.name, "classify_reply");
  assert.equal(bodies[0].model, "claude-haiku-4-5-20251001");
  assert.ok(bodies[0].max_tokens <= 100, "poucos tokens");
  assert.match(bodies[0].messages[0].content, /Pergunta aberta: Aviso Luz/);
  assert.match(bodies[0].messages[0].content, /3\) ⏭️ Pular \[destrutiva\]/);
  assert.match(bodies[0].messages[0].content, /veio de AUDIO/);
  const typed = await (async () => {
    content = [];
    await classifyReply({ ...input, fromAudio: false });
    return bodies[bodies.length - 1].messages[0].content;
  })();
  assert.match(typed, /foi DIGITADA/);
    }
  );
});
