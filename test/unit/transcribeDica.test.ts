// Card 24, parte 3: o Whisper recebe a dica de vocabulario (prompt) e temperatura 0 so quando pedido; eco da dica e reconhecido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHintEcho, REPLY_VOCAB_HINT, transcribeAudio } from "../../src/ai/transcribe";

test("isHintEcho: a dica inteira (com pontuacao e caixa diferentes) ou um pedaco inicial grande dela e eco; frases de verdade nao", () => {
  assert.equal(isHintEcho(REPLY_VOCAB_HINT), true);
  assert.equal(isHintEcho("Sim, não, um, dois, três, já paguei."), true);
  assert.equal(isHintEcho("sim não um dois três"), true, "pedaco inicial com 4+ palavras");
  assert.equal(isHintEcho("sim não"), false, "2 palavras: pode ser uma resposta de verdade");
  assert.equal(isHintEcho("já paguei a conta hoje"), false);
  assert.equal(isHintEcho("um dois três quatro"), false);
  assert.equal(isHintEcho(""), false);
  assert.equal(isHintEcho("a b c d", "a b c d e f"), true, "dica personalizada");
});

test("transcribeAudio: manda prompt e temperature so quando informados (o resto da requisicao nao muda)", async (t) => {
  const forms: FormData[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init?: { body?: FormData }) => {
    forms.push(init!.body as FormData);
    return new Response(JSON.stringify({ text: "já paguei" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(await transcribeAudio(Buffer.from("x")), "já paguei");
  assert.equal(forms[0].get("prompt"), null);
  assert.equal(forms[0].get("temperature"), null);
  assert.equal(forms[0].get("model"), "whisper-large-v3-turbo");
  assert.equal(forms[0].get("language"), "pt");
  await transcribeAudio(Buffer.from("x"), "audio.ogg", { prompt: REPLY_VOCAB_HINT, temperature: 0 });
  assert.equal(forms[1].get("prompt"), REPLY_VOCAB_HINT);
  assert.equal(forms[1].get("temperature"), "0");
});

test("transcribeAudio: erro HTTP vira erro com o status (como antes)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("quota", { status: 429 }));
  await assert.rejects(() => transcribeAudio(Buffer.from("x")), /Erro ao transcrever audio: 429 quota/);
});
