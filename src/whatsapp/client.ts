import { config } from "../config";

async function callEvolutionApi(path: string, body: unknown) {
  const res = await fetch(`${config.evolution.apiUrl}${path}`, {
    method: "POST",
    headers: {
      apikey: config.evolution.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao chamar Evolution API (${path}): ${res.status} ${text}`);
  }
  return res.json();
}

export async function sendText(to: string, text: string) {
  return callEvolutionApi(`/message/sendText/${config.evolution.instanceName}`, {
    number: to,
    text,
  });
}
