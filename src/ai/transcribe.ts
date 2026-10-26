import { config } from "../config";
import { normalizeReply } from "../confirmation/normalize";

// Card 24 (RN09): com pergunta aberta, o Whisper recebe o vocabulario das respostas curtas como dica (e temperatura 0), pra "um", "dois", "ja paguei",
// "pular" e "apagar" sairem certos. A dica e curta de proposito: o Whisper as vezes DEVOLVE a dica quando o audio e so silencio ou ruido.
export const REPLY_VOCAB_HINT = "sim, não, um, dois, três, já paguei, ainda não, me lembra amanhã, pular, confirmar, corrigir, cancelar, apagar";

export interface TranscribeOptions {
  prompt?: string;
  temperature?: number;
}

// a transcricao e (um pedaco inicial grande de) a propria dica: o Whisper ecoou o prompt, nao ouviu nada -- tratar como audio nao entendido
export function isHintEcho(transcript: string, hint: string = REPLY_VOCAB_HINT): boolean {
  const heard = normalizeReply(transcript);
  const expected = normalizeReply(hint);
  if (!heard) return false;
  return heard === expected || (heard.split(" ").length >= 4 && expected.startsWith(heard));
}

export async function transcribeAudio(audio: Buffer, filename = "audio.ogg", options: TranscribeOptions = {}): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio]), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  if (options.prompt) form.append("prompt", options.prompt);
  if (options.temperature !== undefined) form.append("temperature", String(options.temperature));

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao transcrever audio: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}
