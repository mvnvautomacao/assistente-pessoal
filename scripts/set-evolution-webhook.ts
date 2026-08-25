import "dotenv/config";

const apiUrl = process.env.EVOLUTION_API_URL;
const apiKey = process.env.EVOLUTION_API_KEY;
const instanceName = process.env.EVOLUTION_INSTANCE_NAME;
const webhookUrl = process.argv[2];

async function main() {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error("Preencha EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME no .env antes de rodar este script");
  }
  if (!webhookUrl) {
    throw new Error("Uso: npm run evolution:webhook -- https://sua-url/webhook");
  }

  const res = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        events: ["MESSAGES_UPSERT"],
        base64: true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao configurar webhook: ${res.status} ${await res.text()}`);
  }

  console.log(`Webhook configurado para: ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
