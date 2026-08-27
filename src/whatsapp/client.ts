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

// Em algumas versoes/configuracoes da Evolution API, o webhook nao manda o audio/
// imagem em base64 direto no payload (so uma referencia criptografada tipo url +
// mediaKey) mesmo com webhookBase64=true. Esse endpoint busca o conteudo decodificado
// a partir da chave da mensagem.
export async function getBase64FromMediaMessage(key: { remoteJid: string; id: string; fromMe: boolean }) {
  const data = (await callEvolutionApi(`/chat/getBase64FromMediaMessage/${config.evolution.instanceName}`, {
    message: { key },
    convertToMp4: false,
  })) as { base64?: string; mimetype?: string };
  return data;
}
