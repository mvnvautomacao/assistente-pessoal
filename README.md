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

## Deploy em produção (Coolify na Oracle Cloud)

O app já tem um `Dockerfile`, então o Coolify builda e roda ele sozinho — você não precisa mexer com pm2, nginx ou certificado SSL na mão. Só faça isso depois de validar tudo rodando local (branch `develop`); o deploy sempre parte do branch `main`.

### 1. Criar a VM gratuita na Oracle Cloud

1. Crie conta em https://www.oracle.com/cloud/free/ (pede cartão só pra verificação, não cobra nada no tier "Always Free").
2. Compute → Instances → Create Instance.
3. Imagem: **Ubuntu 22.04**. Shape: **VM.Standard.A1.Flex** (Ampere/ARM, é a que entra no free tier — pode deixar 2 OCPU / 12GB, ainda dentro do limite grátis).
4. Adicione sua chave SSH pública (ou deixe a Oracle gerar uma e baixe o arquivo `.pem`).
5. Depois de criada, anote o **IP público** da instância.
6. Libere as portas 80 e 443 (a Oracle bloqueia por padrão em dois lugares — precisa liberar nos dois):
   - No painel: VCN da instância → Security Lists → Add Ingress Rule → portas 80 e 443, origem `0.0.0.0/0`.
   - Dentro da VM (via SSH): `sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT` e o mesmo pra porta 443, depois `sudo netfilter-persistent save` (ou ajuste do `ufw`, dependendo da imagem).

### 2. Instalar o Coolify

Via SSH na VM:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Ao terminar, acesse `http://SEU_IP:8000` no navegador e crie sua conta de admin do Coolify.

### 3. Domínio + Cloudflare

1. Registre o domínio no Registro.br.
2. Aponte os nameservers do domínio pro Cloudflare (Cloudflare te dá 2 endereços tipo `ana.ns.cloudflare.com` na hora que você adiciona o site lá).
3. No Cloudflare, crie um registro **A**: `bot` (ou o subdomínio que preferir) → IP da VM. Deixe a nuvem **cinza (DNS only)** por enquanto — proxy laranja só depois que o certificado SSL do Coolify já estiver funcionando, senão atrapalha a emissão.

### 4. Deploy do app no Coolify

1. No painel do Coolify: **New Resource → Application → conectar seu repositório Git** (GitHub/GitLab), branch `main`. O Coolify detecta o `Dockerfile` automaticamente.
2. Em **Domains**, coloque `bot.seudominio.com.br` — o Coolify emite o certificado Let's Encrypt sozinho.
3. Em **Environment Variables**, cole todas as chaves do seu `.env` (as mesmas do passo de configuração local).
4. Em **Storages**, adicione um volume persistente apontando pra `/app/data` — é onde fica o banco SQLite dos lembretes. Sem isso, os lembretes se perdem a cada novo deploy.
5. Clique em **Deploy**.

### 5. Últimos ajustes

1. No painel da Meta, troque o `META_ACCESS_TOKEN` temporário por um permanente (Business Settings → System Users → gerar token com permissão `whatsapp_business_messaging`).
2. Atualize a Callback URL do webhook na Meta pra `https://bot.seudominio.com.br/webhook`.

### Se um dia precisar escalar (trocar de servidor)

Como o deploy é 100% baseado em Dockerfile + git, migrar de servidor depois é simples e não exige mudar nada no código:

1. Suba um Coolify novo (ou use o recurso de "servidor remoto" do próprio Coolify, que deixa um painel só controlar vários servidores) na VPS maior/paga que você escolher (ex: Hostinger).
2. Reconecte o mesmo repositório e cole as mesmas variáveis de ambiente.
3. No Cloudflare, só troque o IP do registro A pro novo servidor.
4. Único cuidado: o SQLite é um arquivo local, então copie o volume `/app/data` pro servidor novo (`scp`) antes de trocar o DNS. Se no futuro o volume de dados crescer muito, dá pra trocar o SQLite por um banco gerenciado (ex: Supabase) sem tocar no resto do código — é só trocar a camada em [src/db.ts](src/db.ts).

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
