# Assistente Pessoal via WhatsApp

Bot de WhatsApp que:
- Recebe texto, áudio e foto de comprovante
- Registra gastos numa planilha do Google Sheets
- Cria eventos no Google Calendar
- Cria lembretes que o próprio bot te manda de volta no WhatsApp, na hora certa

## Como funciona (visão geral)

1. Você manda uma mensagem no WhatsApp pro número do bot.
2. A Meta (dona do WhatsApp) entrega essa mensagem pro nosso servidor via **webhook**.
3. Se for áudio, transcrevemos (Groq/Whisper). Se for foto, tratamos como comprovante.
4. O texto (ou a imagem) vai pra Claude (Anthropic), que decide: é um gasto, um evento ou um lembrete — e extrai os dados.
5. Dependendo do tipo, gravamos na planilha, criamos o evento no Calendar, ou agendamos o lembrete.
6. O bot responde confirmando no WhatsApp.

## Passo a passo do zero

### 1. Conta no Meta for Developers (WhatsApp Cloud API)

1. Crie um app em https://developers.facebook.com/apps → tipo "Business".
2. Adicione o produto **WhatsApp**.
3. Na aba WhatsApp → API Setup, anote:
   - `Temporary access token` → vai virar `META_ACCESS_TOKEN` (depois trocamos por um permanente)
   - `Phone number ID` → vai virar `META_PHONE_NUMBER_ID`
4. Use o número de teste gratuito que a Meta te dá pra começar (ele só manda mensagem pra números que você cadastrar como "destinatário de teste" — cadastre o seu próprio número).
5. Em `META_VERIFY_TOKEN`, invente qualquer string (ex: `batata123`) — você vai usar o mesmo valor no passo do webhook (passo 5 abaixo).

### 2. Conta no Google Cloud (Calendar + Sheets)

1. Crie um projeto em https://console.cloud.google.com
2. Ative as APIs: **Google Calendar API** e **Google Sheets API**.
3. Em "Tela de consentimento OAuth", configure como app "Externo" e adicione seu próprio e-mail como usuário de teste.
4. Em "Credenciais" → criar credencial → **ID do cliente OAuth** → tipo "App para computador". Anote `Client ID` e `Client Secret`.
5. Crie uma planilha nova no Google Sheets pra guardar os gastos (colunas: Data, Categoria, Descrição, Valor) e copie o ID dela (a parte da URL entre `/d/` e `/edit`).

### 3. Contas de IA

- **Anthropic** (interpreta as mensagens): crie uma chave em https://console.anthropic.com
- **Groq** (transcreve áudio, tem cota gratuita): crie uma chave em https://console.groq.com

### 4. Configurar o projeto localmente

```bash
npm install
cp .env.example .env
```

Preencha o `.env` com tudo que você coletou acima. Depois gere o refresh token do Google (só uma vez):

```bash
npm run google:token
```

Siga as instruções no terminal e cole o `GOOGLE_REFRESH_TOKEN` gerado no `.env`.

### 5. Rodar localmente e conectar o webhook

```bash
npm run dev
```

Isso sobe o servidor na porta 3000, mas a Meta precisa de uma URL pública HTTPS pra mandar as mensagens. Pra testar local, use um túnel temporário, ex:

```bash
npx localtunnel --port 3000
```

Pegue a URL gerada (ex: `https://abcd.loca.lt`) e configure no painel da Meta em WhatsApp → Configuration → Webhook:
- Callback URL: `https://abcd.loca.lt/webhook`
- Verify token: o mesmo valor que você colocou em `META_VERIFY_TOKEN`
- Inscreva-se no campo `messages`

Agora mande uma mensagem de teste pro número do bot pelo seu WhatsApp.

## Deploy em produção (Oracle Cloud Free Tier)

Resumo do que vamos fazer lá na frente, quando o bot estiver validado localmente:

1. Criar uma VM gratuita (Always Free) na Oracle Cloud.
2. Instalar Node.js na VM.
3. Subir o código (via git clone do branch `main`) e configurar o `.env` de produção.
4. Rodar o processo permanentemente com **pm2** (mantém o bot de pé e reinicia sozinho se cair).
5. Apontar um domínio (esse é o único custo real do projeto, ~R$40/ano) pra IP da VM, e usar **Caddy** como proxy — ele gera o certificado HTTPS automaticamente, exigido pela Meta.
6. Trocar o `META_ACCESS_TOKEN` temporário por um token permanente (gerado com um System User no Meta Business Manager).
7. Atualizar a Callback URL do webhook na Meta pra apontar pro domínio de produção.

Vou te guiar em cada um desses passos quando chegarmos lá — não precisa se preocupar com isso agora.

## Fluxo de branches

- `develop`: onde você testa localmente antes de ir pra produção.
- `main`: só recebe o que já foi validado; é o que vai pro servidor de produção.

## Estrutura do projeto

```
src/
  whatsapp/   envio e recebimento de mensagens (Meta Cloud API)
  ai/         transcrição de áudio + interpretação das mensagens (Anthropic/Groq)
  google/     Google Calendar e Google Sheets
  reminders/  armazenamento e disparo dos lembretes agendados
  router.ts   decide o que fazer com cada mensagem recebida
  index.ts    ponto de entrada (servidor + scheduler)
```
