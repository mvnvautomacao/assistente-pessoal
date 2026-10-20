# Assistente Pessoal via WhatsApp

Bot de WhatsApp que:
- Recebe texto, áudio e foto de comprovante
- Registra e categoriza gastos automaticamente (com aprendizado e alerta de orçamento), isolado por número
- Cria e cancela eventos no Google Calendar
- Cria lembretes que o próprio bot te manda de volta no WhatsApp, na hora certa
- Manda relatório de gastos automático (semanal/mensal) e sob demanda
- Edita gastos já registrados pelo WhatsApp: vários campos de uma vez ("muda o 2 pra 45 e pix") e até 5 gastos numa mensagem, sempre com prévia "antes → depois", confirmação única (1 confirmar, 2 corrigir, 3 cancelar), validação de valor/data e desfazer em um passo
- Menu guiado de edição: dizer só "editar" (ou "edita o mercado") mostra os itens numerados e depois as opções de campo (gasto, evento, lembrete e gasto fixo); dá pra escolher vários campos ("1 e 5") e responder uma pergunta curta por campo, caindo na mesma prévia 1/2/3
- Entradas (receitas) pelo WhatsApp: "minhas entradas" lista numerada com o total; "muda o valor do 2 pra 850" (ou "muda o salário pra 3500") edita com prévia 1/2/3, "apaga o 2" pede confirmação (1 apagar / 3 cancelar), "editar" → "Entrada" abre o menu guiado, e "desfaz isso" volta a edição ou a exclusão
- Apagar e remover (evento, lembrete, gasto, compra parcelada, categoria, orçamento, gasto fixo, alerta de conta, juntar categorias e recategorizar em lote) usam sempre a mesma confirmação: o bot mostra o item e pergunta *1* confirma / *3* cancela (no apagar gasto sem dizer qual, *2* mostra os últimos); só uma resposta inequívoca age ("pode ser amanhã" não apaga nada), vale 10 minutos e sobrevive a reinício do servidor
- Agenda: dá pra definir o local e o término do evento pelo WhatsApp ("a consulta é na Clínica Sorriso", "vai até as 17h", "dura 2 horas"), editar vários campos com a opção 2 escolhendo qual corrigir, e adiar um lembrete que acabou de tocar ("adia 30 min", "adia pra amanhã 9h"); editar só título, local ou texto nunca reenvia um aviso que já foi enviado
- Consultas de gastos e entradas do jeito que se pergunta: "mostra as 10 últimas compras" (até 20; sem número, 10), "últimas 5 de mercado no pix", "gastos de mercado" (sem período = os 10 últimos da categoria), "gastos no pix hoje" ou "de mercado essa semana" (lista detalhada filtrada, sem a pergunta de resumo ou detalhado), "quanto gastei em setembro" / "no mês passado" / "no Nubank em setembro" e "gastos de 10 a 20 de setembro" (intervalo de até 366 dias); mês e intervalo valem também para entradas, lista de entradas e saldo. Listas de gastos mostram até 30 linhas (20 em "últimas N") e avisam "…e mais N" com o link do painel, sempre com o total do conjunto completo; "muda o valor do 2" refere-se à última lista mostrada. Valores saem como R$ 38,00 e datas como hoje/ontem/dd/MM; hoje, semana e mês seguem o fuso de São Paulo mesmo com o servidor em UTC
- Cadastro de gasto fixo e de alerta de conta com prévia: "cadastrar gasto fixo", "15 reais gasto fixo dia 10", "gasto fixo internet dia 10" ou "todo dia 10 pago 50 de internet" — o bot pergunta só o que falta (nome, valor, dia) e mostra a prévia *1* confirma / *2* corrige / *3* cancela antes de gravar qualquer coisa; "a cada 45 dias" (intervalo) vira alerta de conta, nunca gasto fixo (o valor, se vier, não é guardado), e "conta fixa" sem valor pergunta se é pra lançar sozinho ou só avisar; avisa duplicata (nome igual ou parecido) e oferece atualizar o que já existe; se o dia do gasto fixo já passou no mês, pergunta se lança o deste mês agora (datado do vencimento) ou só a partir do mês que vem; dia, valor ou intervalo inválido viram nova pergunta; o desfazer desativa o cadastro; a conversa fica em `pending_state` (sobrevive a reinício, expira em 10 min)
- Contas fixas, do aviso à edição: o aviso do alerta de conta chega com a lista *1* já paguei / *2* me lembra amanhã / *3* pular este mês (leitura da mensagem inteira: número, "1", "um" ou frase clara; resposta ambígua nunca fecha nem adia, só repete a lista; um pedido novo é atendido normalmente e o aviso continua aberto); no *1* o bot pergunta o valor ("igual" repete o último, "pular" fecha sem lançar) e lança a despesa de hoje marcada como conta fixa (`expenses.fixed_source` = `user` | `bill_alert` | `recurring`, NULL = avulso — só vira fixo quando o usuário diz "conta fixa"/"gasto fixo" ou quando o lançamento é do alerta/gasto fixo automático), sem resposta em 10 min (valor) ou 20 h (aviso) nada é criado e o alerta volta a perguntar amanhã; consultas aceitam "só contas fixas" (🔁 na lista), a edição de gasto ganhou o campo *Tipo*, e "editar conta fixa" lista os alertas, abre o menu (Nome, Dia do mês, Intervalo e, por intervalo, Próximo aviso) ou entende a frase direta, sempre com prévia *1/2/3* "antes → depois", aviso de nome repetido e desfazer; o aviso em andamento vive em `pending_state` (`bill_checkin`, sobrevive a reinício)
- Agenda no WhatsApp: "o que tenho hoje", "e amanhã?", "agenda da sexta", "agenda do dia 20", "agenda da semana" (segunda a domingo; no meio da semana mostra o restante), "semana que vem", "próximos 15 dias" e "agenda de novembro" respondem com eventos e lembretes juntos, agrupados por dia e em ordem de horário (`• 09:00–10:00 Reunião · Sala 2`, `• ⏰ 14:00 Pagar boleto`), tudo no fuso de São Paulo; um dia mostra o dia inteiro (lembrete já enviado com ✔️, evento em andamento com "agora"), semana/próximos dias mostram só o que ainda vale, e mês nomeado mostra o mês inteiro; "eventos da semana" / "lembretes de amanhã" filtram por tipo; "meus lembretes" lista os 10 próximos pendentes (e "todos os meus lembretes" os futuros), com teto de 30 itens e link do painel (`src/agenda/`)
- Agenda numerada (Card 20): os itens da agenda e de "meus lembretes" saem numerados em sequência contínua (`1. 09:00–10:00 Reunião`, `2. ⏰ 14:00 Pagar boleto`), com a dica `Pra mexer em um item: "edita o 2" ou "cancela o 3".` (constante `AGENDA_ACTION_HINT`). Logo depois, "edita o 2", "cancela o 3", "muda o 4 pra 15h", "apaga o 5", "adia o 1 pra amanhã às 9h" e "me avisa também 1 dia antes do 2" usam `list_ref` e passam pelos mesmos fluxos guiados (prévia 1/2/3, confirmação 1/3, desfazer); o tipo real do item (evento ou lembrete) manda, não o que a IA escolheu; adiar um lembrete ainda pendente vira remarcação com prévia, e editar o horário de um lembrete que já tocou orienta a adiar. A lista de cada número fica em `src/lists/lastShown.ts` (uma por vez: gastos, entradas ou agenda; 10 min; em memória, some no reinício)
- Dia que o mês não tem (31/04, 30/02, 29/02 fora de ano bissexto): lembretes e eventos criados, editados ou adiados para esse dia vão para o último dia do mês, com o mesmo horário, e o bot avisa ("Abril só tem 30 dias, então marquei pro dia 30/04."); se o último dia já passou, vale o próximo mês com o dia pedido; a consulta "agenda do dia 31" mostra o último dia do mês; gasto fixo e alerta de conta do dia 29/30/31 disparam no último dia dos meses curtos (regra única em `src/timeSP.ts`, `effectiveDayOfMonth`) e o texto diz "último dia do mês (vence todo dia 31)"
- Frases soltas de funcionalidade: mensagens curtas (até 5 palavras, sem número, valor ou data) que só nomeiam o que fazer — "trocar categoria", "mudar valor", "trocar forma de pagamento", "editar gasto/evento/lembrete/conta fixa/gasto fixo/entrada", "apagar gasto/evento/lembrete/entrada/gasto fixo/conta fixa", "mudar data" (pergunta "Data de quê?"), "ver meus gastos", "minha agenda" — abrem direto o fluxo guiado certo, sem a IA (catálogo local em `src/intents/looseCommands.ts`); nos três primeiros o número escolhido já pergunta o campo (sem passar pelo menu). Palavra solta de `categoria`/`pagamento`/`valor` responde até 3 sugestões numeradas (estado `loose_suggest`, 10 min). Verbo de editar/apagar sem dados nunca vira "gasto novo" (a IA recebe essa regra no prompt e, se ainda classificar como gasto, o bot sugere editar/apagar/ver gastos). Frases completas ou com dados seguem a IA como sempre
- Listas de gastos para escolher (editar, apagar, "últimas compras") mostram os 10 mais recentes e só gastos até o último dia do mês atual: parcelas de meses futuros de compra parcelada aparecem no mês delas, em consulta de mês/período ou com `include_future` ("mostra as parcelas futuras"); o que vence mais adiante no mês atual vem depois do que já aconteceu, então o gasto registrado agora é sempre o primeiro
- Pedido novo com uma confirmação aberta: se o bot está esperando 1/2/3 (prévia de edição, apagar/remover, menu de campos) e você manda outra coisa — "gastei 30 no uber", "quanto gastei esse mês", "o que tenho amanhã", "recebi 3000 de salário" —, ele deixa a alteração de lado, avisa numa linha e atende o pedido (só registrar, criar e consultar — registrar e criar pedem uma frase de 3 palavras ou mais, então "mercado 40" não vira gasto; editar, apagar, configurar e desfazer nunca trocam a confirmação sozinhos; no máximo 3 dessas interpretações extras por número a cada 10 minutos). O que o bot entende como resposta ("45", "dois", "cancelar") continua sendo resposta e não chama a IA. Se não entender, o "não entendi" ensina a saída ("responde *3* e me manda o pedido de novo"; no menu de campos, em que o 3 é um campo, "responde *cancelar*"), e "desfaz isso" com a confirmação aberta cancela a confirmação e só desfaz a última ação no segundo "desfaz isso"
- Busca e respostas do jeito que se digita e se fala: achar evento, lembrete, gasto fixo ou alerta de conta pelo nome ignora acento e maiúsculas ("remedio" acha "Remédio da pressão", "consulta medica" acha "Consulta médica"), aceita as palavras em qualquer ordem, ignora artigos ("o remédio") e trata `%` e `_` como texto comum; e as confirmações, listas e menus aceitam o número por extenso, como sai da transcrição de áudio — "Um.", "dois", "três" valem como 1, 2 e 3 ("um pouco" ou "dois dias" continuam sendo texto livre)
- Agenda, evento em andamento e aviso fora de hora: o aviso "Daqui a…" só vale até 5 minutos depois do início (antecedência 0 avisa no minuto do início), então remarcar um evento pro passado não manda aviso — a prévia mostra "⚠️ Esse horário já passou — não vou mandar aviso." e o aviso ignorado vai pro log (`event_reminder_skipped`); "editar" e "cancelar" encontram evento que já começou (e o que terminou há até 2 horas), marcado com "· em andamento" nas listas e nas prévias, o que permite esticar o término ("a reunião vai durar 3 horas"); avisos extras ("avisa 1 dia antes") continuam só para eventos que ainda não começaram
- Correções do Card 21: (a) numa mesma mensagem só o primeiro pedido que mexe em registro (editar, apagar, remover, renomear, mesclar...) abre pergunta; os demais respondem "Deixei a alteração/exclusão de "X" pra depois: confirma a de "Y" primeiro e me pede de novo." (lista completa em `src/confirmation/recordActions.ts`, com teste que falha se surgir tipo novo sem decisão); (b) alerta de conta fixa: no máximo **3 avisos sem resposta** por ciclo (um por dia; o 3º traz "⚠️ Último aviso..."); no dia seguinte o ciclo fecha sozinho, sem lançar gasto, e o aviso volta no próximo vencimento (alerta por intervalo: soma o intervalo; mensal: mês que vem). Qualquer resposta (1, 2 ou 3), editar ou confirmar zera a contagem; (c) ao confirmar a prévia de edição de evento, lembrete, gasto fixo ou alerta, o registro é comparado com o da prévia: se mudou no meio ("O evento "X" mudou enquanto a gente conversava (agora está ...). Me pede a alteração de novo.") nada é aplicado; (d) dinheiro sempre `R$ 10,00` e data com hora `qui 15/10 às 10:00` em todas as mensagens; (e) boas-vindas curtas e ajuda por assunto (entradas, consultas de gastos, contas fixas, agenda numerada: "como mexo na agenda").
- **Agenda financeira (Card 22):** "agenda financeira", "o que vence essa semana", "contas a pagar em novembro", "próximas parcelas" ou "quanto vou pagar esse mês" mostram o que vai ser cobrado de hoje em diante (sem período, os próximos 30 dias; aceita semana, mês, "próximos N dias" e dia), por dia, com total previsto. Junta quatro fontes: gastos fixos que lançam sozinhos (`🔁`, com valor), contas fixas dos alertas (`📌`, com o último valor lançado como estimativa `≈` ou "valor a informar"; as por intervalo entram só na próxima data), parcelas de compras parceladas (`🧾 ... parcela 3/6`, pela marca `(parcela i/N)` da descrição) e gastos com data futura (`(lançamento futuro)`). No topo, **Em aberto**: contas cujo vencimento já passou sem resposta (com "2 de 3 avisos" quando houver) e gasto fixo recente que ainda não foi lançado; esses não entram no total. Mais de 30 itens: as 30 primeiras linhas e o link do painel, com o total somando tudo. É só consulta: não altera nada, não numera itens (e invalida a lista numerada anterior). Código: `src/agenda/finance.ts` (coleta), `financeFormat.ts` (texto), recorte em `range.ts` (`scope: "finance"`). Diferente de "quanto gastei esse mês", que soma o que já foi gasto.
- Painel visual dos gastos em `/dashboard`

## Como funciona (visão geral)

1. Você manda uma mensagem no WhatsApp pro número do bot.
2. O **Evolution API** (nossa própria conexão com o WhatsApp, autohospedada) entrega essa mensagem pro nosso servidor via **webhook**.
3. Se for áudio, transcrevemos (Groq/Whisper). Se for foto, tratamos como comprovante.
4. O texto (ou a imagem) vai pra Claude (Anthropic), que decide o que é (gasto, evento, lembrete, etc.) e extrai os dados.
5. Tudo fica guardado num banco SQLite local, isolado por número de quem mandou a mensagem — um número nunca vê nem herda categorias/dados de outro.
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

### 2. Conta no Google Cloud (Calendar)

1. Crie um projeto em https://console.cloud.google.com
2. Ative a API: **Google Calendar API**.
3. Em "Tela de consentimento OAuth", configure como app "Externo" e adicione seu próprio e-mail como usuário de teste.
4. Em "Credenciais" → criar credencial → **ID do cliente OAuth** → tipo "App para computador". Anote `Client ID` e `Client Secret`.

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

**Recomendado antes de expor pra internet:** defina `WEBHOOK_SECRET` (uma string aleatória) nas variáveis de ambiente do app no Coolify, e inclua `?secret=` na URL acima ao registrar o webhook — sem isso, qualquer pessoa que descobrir essa URL consegue mandar mensagens falsas pro sistema.

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
  google/     wrapper do Google Calendar, sem uso ativo hoje (fica pronto pra
              quando a conexão opcional com o Google for implementada)
  expenses/   gastos, categorias, formas de pagamento, orcamentos e relatorios (tudo isolado por numero)
  events/     agenda e lembretes de eventos, local no banco (tambem isolado por numero)
  reminders/  lembretes avulsos: armazenamento e disparo agendado
  dashboard/  painel visual (`/dashboard?phone=<numero>`) — gastos, categorias,
              formas de pagamento, agenda e lembretes, tudo com CRUD
  router.ts   decide o que fazer com cada mensagem recebida
  index.ts    ponto de entrada (servidor + schedulers)
test/
  unit/       testa modulos isolados (categorias, orcamento, datas, caches...)
  functional/ testa o dashboard (HTTP de verdade) e o fluxo completo do
              WhatsApp (com a IA e o envio de mensagem mockados)
```

## Estado de conversa (pendências e desfazer)

As confirmações de edição (gasto, evento, lembrete, gasto fixo, entrada), a exclusão de entrada e as demais exclusões/remoções com confirmação, o menu guiado de campos, a escolha numerada de item, o "editar" sem alvo e o "desfazer isso" ficam na tabela `pending_state` do SQLite (veja [src/pending/store.ts](src/pending/store.ts)), uma linha por número e tipo. Por isso um deploy ou reinício do servidor **não** perde a conversa: quem estava numa prévia "1 Confirmar / 2 Corrigir / 3 Cancelar" responde normalmente depois. O banco precisa estar no volume persistente (`/app/data`, veja o passo do Coolify acima).

- Prazo de 10 minutos (`EDIT_PENDING_TTL_MS`). Se a pessoa responde só "1", "sim", "2", "3", "cancelar" ou "desfaz" **depois** do prazo (até 60 minutos), o bot explica que expirou em vez de interpretar a mensagem como outro pedido (veja [src/pending/expiredNotice.ts](src/pending/expiredNotice.ts)). Um pedido completo ("muda o mercado pra 40") é processado normalmente.
- Uma rotina limpa as linhas vencidas há mais de 60 minutos (na inicialização e a cada 10 minutos).
- Toda mensagem de sucesso de uma ação que registra desfazer termina com "Errou? Responde *desfazer*." (um só ponto no código: [src/undo/replyWithUndo.ts](src/undo/replyWithUndo.ts)). Só o último desfazer de cada número fica disponível.
- Os demais pendentes mais antigos (completar gasto, forma de pagamento, check-in de conta, aviso adiantado, recibo...) e as listas numeradas de gastos/entradas continuam em memória; o store é genérico para migrá-los depois.

## Rotinas agendadas e recuperação

Deploy, reinício ou queda da VM não fazem mais o sistema perder o que estava agendado. As rotinas **diárias** (gastos fixos, alertas de conta fixa,
relatório semanal e mensal) rodam num executor único (`src/scheduler/dailyJobs.ts`): um cron por minuto (fuso de São Paulo) mais uma execução ~20 s
depois de subir. Cada rotina tem uma hora "a partir de", roda **no máximo uma vez por dia** (registro em `job_runs`, reivindicação atômica) e, se o servidor
estava fora na hora, recupera ao voltar. A proteção contra repetição fica no **item** (`recurring_expenses.last_run_month`, `bill_alerts.last_asked_date` e
`confirmed_month`), então rodar duas vezes nunca duplica lançamento nem mensagem.

| Rotina | Hora | Se o servidor estava fora na hora |
|---|---|---|
| Gastos fixos | 07:00 | recupera até **7 dias**; lança com a **data do vencimento** e a linha `(lançado com atraso: vencia dia 05/10)`; só o que já existia no vencimento |
| Alertas de conta fixa | 08:00 | recupera o ciclo pendente (inclusive o do mês anterior): aviso 1 com `(atrasado: vencia dia 10)`; alerta cadastrado depois do vencimento só avisa no próximo |
| Relatório semanal | 09:00 | recupera **só no mesmo dia** (até 23:59); no dia seguinte a execução fica registrada como **perdida** |
| Relatório mensal | 18:00, último dia | recupera até o **dia 2** do mês seguinte, com o nome do mês que acabou, uma vez só |
| Lembretes | a cada minuto | sem limite de idade; atrasado em mais de 10 min sai com `⏰ (atrasado: era pra …)`; no máximo **10 por minuto**, do mais antigo ao mais novo |
| Avisos de evento | a cada minuto | atrasado em mais de 2 min diz os minutos que de fato faltam (`Daqui a 20 min`); evento que já começou continua sem aviso |
| "Sem gastos hoje" | horário do usuário | já se recuperava no mesmo dia (não mudou) |

- Falha de envio (ex.: Evolution fora do ar): a rotina não é dada como concluída e tenta de novo no minuto seguinte, **no máximo 3 vezes por dia**; o gasto fixo cujo aviso não saiu é desfeito e refeito na tentativa seguinte.
- `scheduler_heartbeat` guarda o último batimento (1 por minuto). Ao subir, se passou mais de **5 minutos**, o período fora do ar vira uma entrada `downtime` no log do dono (`servidor fora do ar de 19/10 06:58 a 19/10 07:39 (41 min)`); execuções de relatório que não dá mais para recuperar viram `job_runs.status = 'missed'` e uma entrada `job_missed`.
- Na primeira subida com este recurso, os relatórios de hoje que o agendador antigo já tenha mandado ficam marcados como tratados (não saem em dobro).
- O `/admin` tem a seção **Rotinas agendadas**: as últimas 30 execuções (rotina, dia, início, fim, status, itens, tentativas) e as últimas quedas.
- **Limpeza do log de atividade (Card 21):** a rotina `limpeza_log` (3h, uma vez por dia, aparece em `job_runs` e no `/admin`) apaga do `activity_log` as linhas mais velhas que `ACTIVITY_LOG_RETENTION_DAYS` dias — de todos os tipos, inclusive tentativas bloqueadas e quedas. Padrão **90**; `0` desliga a limpeza (guarda tudo); valor inválido volta para 90. O `/admin` mostra a retenção em vigor. Existe índice em `activity_log(created_at)`.
- **Média de mensagens por mês no `/admin`:** a tabela *Números autorizados* tem a coluna **Média de mensagens/mês** (cliente + bot, com o detalhe "cliente X · bot Y"). A tabela `message_counts` conta por número e por mês (fuso de SP) o que o cliente mandou (qualquer mensagem de número autorizado) e o que o bot enviou (só o que a Evolution API aceitou). A média é o total dividido pelos meses desde o primeiro registro até o mês atual (o mês em andamento conta inteiro). **Só há dados a partir do deploy que criou a tabela e o histórico anterior não existe nem é estimado.** Para a tela não enganar (Card 22): a data de início da contagem fica em `app_meta` (`message_counts_since`, gravada uma vez na primeira mensagem; para dados que já existiam, vale o dia 1 do menor mês e aparece com `~`) e é mostrada acima da tabela e no cabeçalho da coluna; número sem mensagens mostra `0` em cinza (com o tooltip do início), nunca "—"; e com menos de 30 dias de contagem a célula mostra o total e o período (`42 em 5 dias`, com o detalhe cliente x bot) em vez de uma média mensal.
- **Atenção no Coolify:** o `job_runs` e o resto do SQLite vivem em `/app/data`; sem o volume persistente montado, tudo some a cada deploy e a recuperação não tem em que se apoiar.
- **Verificação do volume (Card 22):** o `Dockerfile` define `DB_PATH=/app/data/data.sqlite` por padrão (o valor das variáveis do Coolify continua mandando). Na subida, em container (existe `/.dockerenv`), o sistema compara o disco (`stat.dev`) da pasta do banco com o de `/`: o **mesmo** disco significa que a pasta está no sistema de arquivos efêmero do container, ou seja, **sem volume persistente**; discos diferentes significam que há um volume montado. Se a pasta do banco não for `/app/data` o status também vira "atenção". Sem volume ou com o caminho fora de `/app/data`: `console.error`, mensagem ao dono por WhatsApp (no máximo uma por hora) e aviso vermelho fixo no topo do `/admin`; com tudo certo, o `/admin` mostra a linha discreta `Banco: /app/data/data.sqlite · volume persistente verificado`. Fora de container (desenvolvimento) a verificação não se aplica, e uma falha ao verificar vira "não verificado" no log, sem derrubar nada. **Criar o volume continua sendo manual no Coolify** (Storages → volume persistente em `/app/data`). Limites: um `tmpfs` montado em `/app/data` tem disco diferente de `/` mas é efêmero (a verificação não o distingue); num deploy novo em que o volume foi montado agora e o banco recomeçou vazio, `message_counts_since` e `job_runs` recomeçam — copie o `data.sqlite` antigo para o volume, se ele existir. Código: `src/storage/volumeCheck.ts` (regra pura) e `volumeAlert.ts` (subida e alerta).

## Testes

```bash
npm test
```

Roda tudo (`tsc` + o test runner nativo do Node) contra um banco SQLite
temporário — nunca toca no `data.sqlite` de verdade. Cobre isolamento entre
números (multi-tenant), os fluxos de conversa com estado (categorização
pendente, editar gasto por número da lista, resumo x detalhado) e checagens de
segurança (um número não conseguir editar dado de outro, escapamento de HTML).

Antes de commitar, rode `npm run check` (lint + testes). Os três scripts de apoio:

```bash
npm run lint      # tsc -p tsconfig.lint.json: código morto (imports, variáveis e parâmetros sem uso); não gera arquivos
npm run coverage  # compila, roda a suíte com a cobertura nativa do Node e imprime a tabela por arquivo (sem os testes)
npm run check     # lint + testes
```

O lint fica fora do `npm run build` (e do `tsconfig.json`) de propósito: um import esquecido nunca derruba o deploy. Parâmetro ignorado de propósito leva prefixo `_`. A cobertura só mede e imprime (sem mínimo que quebre o comando); linha de base no Node 24.19: 93,4 % das linhas, 92,2 % dos ramos e 94,8 % das funções.
