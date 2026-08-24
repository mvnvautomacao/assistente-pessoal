import { config } from "../config";

const GRAPH_URL = `https://graph.facebook.com/v20.0/${config.meta.phoneNumberId}/messages`;

async function callGraphApi(body: unknown) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.meta.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao enviar mensagem no WhatsApp: ${res.status} ${text}`);
  }
  return res.json();
}

export async function sendText(to: string, text: string) {
  return callGraphApi({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

export async function downloadMedia(mediaId: string): Promise<Buffer> {
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.meta.accessToken}` },
  });
  if (!metaRes.ok) throw new Error(`Erro ao buscar metadados da midia: ${metaRes.status}`);
  const { url } = (await metaRes.json()) as { url: string };

  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${config.meta.accessToken}` },
  });
  if (!fileRes.ok) throw new Error(`Erro ao baixar midia: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}
