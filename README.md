# Assistente Pessoal via WhatsApp

Bot de WhatsApp que:
- Recebe texto, áudio e foto de comprovante
- Registra gastos numa planilha do Google Sheets
- Cria eventos no Google Calendar
- Cria lembretes que o próprio bot te manda de volta no WhatsApp, na hora certa

## Como funciona (visão geral)

1. Você manda uma mensagem no WhatsApp pro número do bot.
2. O **Evolution API** (nossa própria conexão com o WhatsApp, autohospedada) entrega essa mensagem pro nosso servidor via **webhook**.
3. Se for áudio, transcrevemos (Groq/Whisper). Se for foto, tratamos como comprovante.
4. O texto (ou a imagem) vai pra Claude (Anthropic), que decide: é um gasto, um evento ou um lembrete — e extrai os dados.
5. Dependendo do tipo, gravamos na planilha, criamos o evento no Calendar, ou agendamos o lembrete.
6. O bot responde confirmando no WhatsApp.

Usamos o [Evolution API](https://github.com/EvolutionAPI/evolution-api) em vez da API oficial da Meta: conecta como o WhatsApp Web (escaneando um QR code), sem precisar de aprovação de conta comercial. Roda em Docker, local pra testes e no Coolify em produção.

## Passo a passo do zero

### 1. Evolution API (conexão com o WhatsApp)

Local, pra testar (precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto):

```bash
docker compose up -d
```

Isso sobe o Evolution API em `http://localhost:8080`. Depois, com o `.env` já preenchido (veja o passo 4), rode:

```bash
npm run evolution:setup
```

Um QR code vai aparecer no terminal. Abra o WhatsApp no celular → **Aparelhos conectados** → **Conectar um aparelho** → escaneie. Pronto, a instância fica conectada.

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

Um link vai aparecer no terminal: abra ele, faça login com sua conta Google e clique em "Continuar"/"Permitir". O terminal captura a autorização sozinho e já imprime a linha `GOOGLE_REFRESH_TOKEN=...` pronta pra colar no `.env`.

### 5. Rodar localmente e conectar o webhook

```bash
npm run dev
```

Isso sobe o servidor na porta 3000. Como o Evolution API roda no Docker Desktop, na mesma máquina, ele consegue chamar seu servidor local direto — não precisa de túnel nem de domínio pra testar:

```bash
npm run evolution:webhook -- http://host.docker.internal:3000/webhook
```

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

Boa notícia: como não dependemos mais do webhook da Meta, **não precisa de domínio nem de certificado SSL pra funcionar** — o Evolution API e o app conversam direto pela rede interna do Coolify. Domínio só se você quiser acessar o app de fora por algum motivo (opcional, não vamos precisar).

### 3. Deploy do Evolution API no Coolify

1. No painel do Coolify, crie um **Project** novo (ex: "assistente-pessoal") — os serviços dentro do mesmo projeto conseguem se enxergar pela rede interna.
2. **New Resource → Docker Compose** → aponte pro seu repositório Git, branch `main`, arquivo `docker-compose.yml` (já está na raiz do projeto).
3. Em **Environment Variables**, adicione `EVOLUTION_API_KEY` com o mesmo valor que está no seu `.env`.
4. Clique em **Deploy**. Anote o nome do serviço (por padrão `evolution-api`) — é o endereço que o app vai usar pra falar com ele dentro da rede do Coolify (`http://evolution-api:8080`).

### 4. Deploy do app no Coolify

1. No mesmo Project: **New Resource → Application → conectar seu repositório Git**, branch `main`. O Coolify detecta o `Dockerfile` automaticamente.
2. Em **Environment Variables**, cole as chaves do seu `.env`, mas troque `EVOLUTION_API_URL` para `http://evolution-api:8080` (o endereço interno, não `localhost`).
3. Em **Storages**, adicione um volume persistente apontando pra `/app/data` — é onde fica o banco SQLite dos lembretes. Sem isso, os lembretes se perdem a cada novo deploy.
4. Clique em **Deploy**.

### 5. Últimos ajustes

A instância do WhatsApp em produção é separada da que você usou nos testes locais — precisa conectar de novo:

```bash
EVOLUTION_API_URL=http://SEU_IP_DA_VM:PORTA_DO_EVOLUTION npm run evolution:setup
```

(a porta exposta você vê no painel do Coolify, na aba do serviço `evolution-api`). Escaneie o QR code de novo com o WhatsApp. Depois, configure o webhook apontando pro endereço interno do app:

```bash
npm run evolution:webhook -- http://assistente-whatsapp:3000/webhook
```

(troque `assistente-whatsapp` pelo nome que o Coolify deu ao serviço do app, visível no painel).

### Se um dia precisar escalar (trocar de servidor)

Como o deploy é 100% baseado em Dockerfile/docker-compose + git, migrar de servidor depois é simples e não exige mudar nada no código:

1. Suba um Coolify novo (ou use o recurso de "servidor remoto" do próprio Coolify, que deixa um painel só controlar vários servidores) na VPS maior/paga que você escolher (ex: Hostinger).
2. Reconecte o mesmo repositório e cole as mesmas variáveis de ambiente, pros dois serviços (app e Evolution API).
3. Único cuidado: tanto o SQLite (`/app/data`) quanto a sessão do WhatsApp (volume `evolution_instances`) são arquivos locais — copie os dois volumes pro servidor novo antes de desligar o antigo, ou vai precisar escanear o QR code de novo. Se no futuro o volume de dados crescer muito, dá pra trocar o SQLite por um banco gerenciado (ex: Supabase) sem tocar no resto do código — é só trocar a camada em [src/db.ts](src/db.ts).

## Fluxo de branches

- `develop`: onde você testa localmente antes de ir pra produção.
- `main`: só recebe o que já foi validado; é o que vai pro servidor de produção.

## Estrutura do projeto

```
src/
  whatsapp/   envio e recebimento de mensagens (Evolution API)
  ai/         transcrição de áudio + interpretação das mensagens (Anthropic/Groq)
  google/     Google Calendar e Google Sheets
  reminders/  armazenamento e disparo dos lembretes agendados
  router.ts   decide o que fazer com cada mensagem recebida
  index.ts    ponto de entrada (servidor + scheduler)
```
