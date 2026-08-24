import { config } from "../config";

export async function transcribeAudio(audio: Buffer, filename = "audio.ogg"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio]), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");

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
