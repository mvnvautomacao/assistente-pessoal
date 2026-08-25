import "dotenv/config";
import qrcodeTerminal from "qrcode-terminal";

const apiUrl = process.env.EVOLUTION_API_URL;
const apiKey = process.env.EVOLUTION_API_KEY;
const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

async function main() {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error("Preencha EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME no .env antes de rodar este script");
  }

  const createRes = await fetch(`${apiUrl}/instance/create`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
  });

  if (!createRes.ok && createRes.status !== 403) {
    // 403 costuma significar "instancia ja existe", o que e ok pra gente aqui.
    throw new Error(`Falha ao criar instancia: ${createRes.status} ${await createRes.text()}`);
  }

  const connectRes = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
    headers: { apikey: apiKey },
  });
  if (!connectRes.ok) {
    throw new Error(`Falha ao buscar QR code: ${connectRes.status} ${await connectRes.text()}`);
  }

  const data = (await connectRes.json()) as { code?: string; base64?: string };
  if (!data.code) {
    console.log("Resposta da API:", JSON.stringify(data, null, 2));
    throw new Error("A API nao retornou um QR code. Talvez o WhatsApp ja esteja conectado nessa instancia.");
  }

  console.log("\nEscaneie esse QR code no WhatsApp (Aparelhos conectados > Conectar um aparelho):\n");
  qrcodeTerminal.generate(data.code, { small: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
