# Organizaí — Documentação Negocial do Sistema

> Assistente pessoal de finanças e agenda que funciona dentro do WhatsApp, com um painel no site para consultar e ajustar tudo.
> Este documento descreve **o que o sistema faz hoje**, módulo por módulo, em linguagem de negócio. Não é necessário conhecimento técnico para lê-lo.
> Posição: Cards 1 a 22 entregues (outubro de 2026).

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Acesso, segurança e cadastro de clientes](#2-acesso-segurança-e-cadastro-de-clientes)
3. [Como o assistente conversa (confirmações, desfazer, ajuda)](#3-como-o-assistente-conversa)
4. [Gastos](#4-gastos)
5. [Compras parceladas](#5-compras-parceladas)
6. [Categorias](#6-categorias)
7. [Formas de pagamento e limite de cartão](#7-formas-de-pagamento-e-limite-de-cartão)
8. [Orçamento mensal por categoria](#8-orçamento-mensal-por-categoria)
9. [Entradas (receitas) e saldo](#9-entradas-receitas-e-saldo)
10. [Gastos fixos (lançamento automático)](#10-gastos-fixos-lançamento-automático)
11. [Contas fixas (alertas "já pagou?")](#11-contas-fixas-alertas-já-pagou)
12. [Agenda: eventos](#12-agenda-eventos)
13. [Lembretes](#13-lembretes)
14. [Consulta da agenda e lista numerada](#14-consulta-da-agenda-e-lista-numerada)
15. [Agenda financeira ("o que vence")](#15-agenda-financeira-o-que-vence)
16. [Relatórios e avisos automáticos](#16-relatórios-e-avisos-automáticos)
17. [Painel do cliente (site): acesso e navegação](#17-painel-do-cliente-site-acesso-e-navegação)
18. [Painel do administrador (site)](#18-painel-do-administrador-site)
19. [Rotinas automáticas e confiabilidade](#19-rotinas-automáticas-e-confiabilidade)
20. [Limites e o que o sistema ainda não faz](#20-limites-e-o-que-o-sistema-ainda-não-faz)
21. [Anexos: quadro de horários e glossário](#21-anexos)

---

## 1. Visão geral

**O que é.** O Organizaí é um assistente pessoal que o cliente usa conversando no WhatsApp, do jeito que fala. Com ele o cliente:

- registra **gastos** e **entradas de dinheiro**;
- controla **contas fixas**, **gastos fixos** (que se repetem todo mês) e **compras parceladas**;
- define **orçamento mensal** por categoria e recebe avisos;
- marca **compromissos** na agenda e cria **lembretes**;
- consulta o que gastou, o que recebeu, o que tem na agenda e **o que vai vencer**;
- recebe **relatórios e avisos automáticos** no WhatsApp;
- vê e edita tudo em um **painel no site**.

**Dois canais, um mesmo cadastro.** Tudo o que o cliente faz no WhatsApp aparece no site e vice-versa. Cada cliente enxerga **apenas os próprios dados**: um número nunca vê nem herda categorias, gastos ou compromissos de outro.

**Quem usa o quê**

| Quem | Onde | Para quê |
|---|---|---|
| Cliente | WhatsApp | Uso do dia a dia: registrar, consultar, editar, receber avisos |
| Cliente | Site (painel do cliente) | Ver gráficos e listas, editar em tela, exportar planilha, ajustar configurações |
| Administrador (dono do sistema) | Site (painel do administrador) | Liberar e bloquear números, controlar cobrança, acompanhar a saúde do sistema |

**Como o cliente fala com o assistente.** Mensagens de **texto**, **áudio** (transcrito automaticamente) e **foto de comprovante/nota fiscal**. Outros tipos de mensagem (figurinha, documento, vídeo) recebem a resposta: "Por enquanto só entendo texto, áudio e imagem de comprovante". Mensagens de **grupos** são sempre ignoradas.

**Convenções deste documento**

- 💬 **No WhatsApp** — o que o cliente diz e o que o assistente responde. Os exemplos entre aspas são frases reais que funcionam.
- 🖥️ **No site** — o que existe no painel do cliente (ou do administrador).
- 📏 **Regras e limites** — comportamentos que o cliente precisa saber.
- Valores aparecem sempre como **R$ 10,00** e datas com hora como **qui 15/10 às 10:00** (horário de Brasília).

---

## 2. Acesso, segurança e cadastro de clientes

### 2.1 Quem pode usar

O assistente **só responde números autorizados** pelo administrador. Qualquer outro número é ignorado em silêncio (nada é respondido); isso evita que o assistente converse sem parar com outro robô. Cada tentativa de número desconhecido fica registrada no painel do administrador e o dono é avisado por WhatsApp (no máximo uma vez por hora por número), para poder aprovar rapidamente quem for legítimo.

Um número pode ainda ser **bloqueado**: ele nunca recebe **nada** do assistente (nem resposta, nem lembrete, nem relatório). O bloqueio vale mais que a autorização.

### 2.2 Primeiro contato

💬 Quando um número autorizado fala pela primeira vez, recebe uma **mensagem de boas-vindas curta** (cabe em uma tela) com exemplos de como usar: registrar gasto, entrada, compromisso, lembrete, consultar, conta fixa, editar/apagar pelo número da lista, desfazer e pedir "ajuda". O link do painel vai junto. O cliente pode pedir a mensagem de novo ("manda a mensagem de boas-vindas").

Categorias e formas de pagamento iniciais são criadas automaticamente (ver módulos 6 e 7), e o relatório semanal e o aviso de gasto pendente já vêm ligados.

### 2.3 Proteções automáticas

- **Freio de emergência:** se um número manda mais de 20 mensagens em 5 minutos (padrão de robô, não de pessoa), o assistente pausa as respostas a ele por 30 minutos. Isso protege contra loops e gasto descontrolado com inteligência artificial.
- **Valores absurdos:** gastos acima de **R$ 1.000.000,00** são recusados com pedido para conferir o valor; valores zero ou negativos também.
- **Isolamento por número:** todas as consultas são filtradas pelo número de quem pergunta.

### 2.4 Acesso ao site (cliente)

🖥️ Veja o módulo 17. Resumo: o cliente entra com o **número de WhatsApp + uma senha que o próprio sistema gera e envia por WhatsApp**. Nunca existe senha digitada por terceiros.

---

## 3. Como o assistente conversa

Este módulo reúne as regras de conversa que valem para **todos** os demais módulos.

### 3.1 Falar do jeito natural

💬 O cliente escreve ou fala normalmente ("gastei 50 no mercado", "marca dentista amanhã 15h"). O assistente identifica se é gasto, entrada, evento, lembrete, consulta etc. Se faltar algum dado, **pergunta só o que falta**, sem fazer o cliente repetir o que já disse. Se não entender, diz isso e orienta.

### 3.2 Confirmar antes de mudar: o padrão 1 / 2 / 3

Antes de gravar mudanças importantes, o assistente mostra um **resumo** e pede a resposta:

| Situação | Opções |
|---|---|
| **Prévia de alteração ou cadastro** (editar gasto, evento, lembrete, gasto fixo, alerta, entrada; cadastrar gasto fixo) | **1** Confirmar · **2** Corrigir · **3** Cancelar |
| **Exclusão ou remoção** (apagar gasto, evento, lembrete, categoria, orçamento, gasto fixo, alerta, juntar categorias, recategorizar em lote) | **1** Confirmar · **3** Cancelar |

- A prévia de edição mostra **antes → depois** de cada campo.
- A opção **2 Corrigir** deixa o cliente trocar só o valor errado, sem recomeçar.
- Só uma resposta **inequívoca** age. "Pode ser amanhã" não apaga nada. Respostas como "sim", "👍", "um", "dois", "três" (inclusive as que vêm de áudio) são entendidas; texto ambíguo apenas repete a pergunta.
- A confirmação **vale 10 minutos** e **sobrevive a reinício do servidor**. Depois disso, o assistente avisa que expirou.
- **"cancelar"** (ou a opção 3) encerra o que estiver pendente: "Beleza, não mexi em nada."

### 3.3 Uma confirmação por vez

Se o cliente pede várias mudanças em registros na mesma mensagem (ex.: "apaga o gasto A e muda o gasto B para 25"), o assistente atende **apenas a primeira** e avisa que deixou as outras para depois: *"Deixei a alteração de "X" pra depois: confirma a de "Y" primeiro e me pede de novo."* Assim nunca há duas perguntas abertas que se confundam.

### 3.4 Pedido novo no meio de uma confirmação

Com uma confirmação aberta, se o cliente manda outro pedido de **registrar, criar ou consultar** ("gastei 30 no uber", "quanto gastei esse mês", "o que tenho amanhã"), o assistente deixa a alteração de lado, avisa em uma linha e atende o novo pedido. Pedidos de editar, apagar, configurar ou desfazer **nunca** trocam a confirmação sozinhos.

### 3.5 Item mudou enquanto conversavam

Ao confirmar uma edição, o assistente confere se o registro continua igual ao da prévia. Se mudou (por exemplo, o cliente editou pelo site), **nada é aplicado** e ele avisa: *"O evento "X" mudou enquanto a gente conversava (agora está qui 15/10 às 10:00). Me pede a alteração de novo."* Se o item foi apagado: "Não achei mais esse item."

### 3.6 Desfazer

💬 Toda mensagem de sucesso que pode ser revertida termina com a frase **"Errou? Responde desfazer."**. Dizer "desfaz isso" volta a **última ação** (registro, edição, exclusão, cadastro). Desfazer duas vezes seguidas não desfaz duas ações: a segunda recebe "Não tem nada recente pra eu desfazer."

### 3.7 Listas numeradas e "edita o 2"

Quando o assistente mostra uma lista (gastos, entradas ou agenda), cada item tem um número. Logo depois, o cliente pode dizer "edita o 2", "muda o valor do 3 para 45", "apaga o 5", "cancela o 4". O número vale **por 10 minutos**, **para a última lista mostrada** (gastos, entradas e agenda dividem a mesma "última lista"). Se a lista expirou, o assistente não adivinha: mostra os itens recentes para escolher.

### 3.8 Frases soltas

Mensagens curtas (até 5 palavras, sem número, valor ou data) que só dizem **o que o cliente quer fazer** abrem o fluxo guiado certo: "editar gasto", "apagar evento", "trocar categoria", "mudar data", "ver meus gastos", "minha agenda". Palavras isoladas como "categoria" ou "pagamento" geram até 3 sugestões numeradas.

### 3.9 Menu guiado de edição

Dizer só **"editar"** mostra o que dá para editar. Para cada item, o assistente lista os itens numerados e depois as **opções de campo** (ex.: Valor, Data, Descrição, Forma de pagamento, Categoria, Tipo). O cliente pode escolher vários campos ("1 e 5") e responder uma pergunta curta por campo, caindo na mesma prévia 1/2/3.

### 3.10 Ajuda

💬 "Ajuda", "o que você faz" ou perguntas como "como adiciono um gasto?" trazem explicações com exemplos prontos para copiar. Há ajuda por assunto: gasto, evento, lembrete, orçamento, consultas de gastos, editar gasto, categoria, forma de pagamento, gasto fixo e contas fixas, entradas, agenda numerada e agenda financeira.

### 3.11 Busca tolerante

Para achar evento, lembrete, gasto fixo ou conta pelo nome, o assistente **ignora acentos e maiúsculas**, aceita as palavras em qualquer ordem e ignora artigos ("o remédio" acha "Remédio da pressão").

---

## 4. Gastos

### 4.1 Registrar um gasto

💬 **O que dizer:** "gastei 50 reais no mercado", "35,90 na farmácia no pix", "uber 30", ou mandar um **áudio** falando a mesma coisa, ou uma **foto do comprovante**.

**O que o assistente faz**

1. Entende o **valor** e a **descrição**; se faltar um deles, pergunta apenas o que falta.
2. Escolhe a **categoria** sozinho (ex.: "mercado" → Mercado, "uber" → Transporte). Se não souber, **pergunta** e **aprende** a escolha para as próximas vezes (palavra-chave → categoria, por cliente).
3. Usa a **forma de pagamento padrão** do cliente; se o cliente citou ("no pix"), usa a citada. Se não há padrão, pergunta, e pode guardar a escolha como padrão.
4. Entende a **data** quando citada ("ontem", "sexta passada", "dia 10"); sem data, vale **hoje**.
5. Responde com o resumo (valor, categoria, data, forma de pagamento) e a dica de desfazer.
6. Se a categoria tem **orçamento** e o gasto fez o mês bater **80%** ou **100%**, anexa um aviso (módulo 8).

**Vários gastos em uma mensagem** ("50 no mercado e 30 de uber") são registrados juntos.

**Conta fixa:** dizer "conta fixa" ou "gasto fixo" junto marca o gasto como fixo (aparece com o rótulo "(conta fixa)").

### 4.2 Registrar por foto (comprovante / nota fiscal)

💬 O cliente envia a foto. O assistente lê **valor total, data, estabelecimento** e escolhe **uma categoria** pelo tipo de compra (nunca item por item). A **forma de pagamento nunca vem da foto**: é sempre perguntada. Como foto erra mais que texto, **sempre** pede confirmação antes de registrar. Foto ilegível: pede para reenviar mais nítida ou digitar o gasto.

### 4.3 Editar um gasto

💬 "muda o valor do 2 para 45", "o mercado era 45 e é da categoria Lazer", "muda o nome do último gasto para Aluguel", "o 3 foi ontem, no crédito".

- Edita **valor, data, descrição, forma de pagamento, categoria e tipo (fixo ou avulso)**.
- Até **6 mudanças** no mesmo gasto e até **5 gastos** numa mesma mensagem.
- Sempre com **prévia "antes → depois"** e confirmação 1/2/3; valida valor e data.
- O cliente pode se referir pelo **número da última lista** ou descrever o gasto por texto ("o gasto do mercado"); sem referência, é o gasto mais recente.
- Se o gasto mudou enquanto conversavam, nada é aplicado (item 3.5).

### 4.4 Apagar um gasto

💬 "apaga o último gasto", "exclui o gasto do mercado", "apaga o 2". O assistente mostra o gasto e pergunta **1 apagar / 3 cancelar**. Se o cliente só disser "apagar um gasto", mostra os últimos para escolher.

### 4.5 Consultar gastos

💬 O cliente pergunta como falaria:

| Pergunta | Resultado |
|---|---|
| "quanto gastei esse mês / essa semana / hoje" | **Resumo**: total, quantidade de gastos, comparação percentual com o período anterior e total por categoria |
| "quanto gastei em setembro", "no mês passado" | Resumo do mês |
| "quanto gastei no Nubank em setembro", "em mercado" | Resumo filtrado por forma de pagamento ou categoria |
| "gastos de 10 a 20 de setembro" | Intervalo de até 366 dias |
| "mostra as 10 últimas compras", "últimas 5 de mercado no pix" | **Lista detalhada** (até 20 por vez) |
| "gastos de mercado essa semana", "gastos no pix hoje" | Lista detalhada filtrada |
| "só contas fixas" | Lista só dos gastos marcados como fixos (com 🔁) |
| "qual o total" (logo após uma lista) | Soma da lista mostrada |

📏 Listas mostram até **30 linhas** (20 em "últimas N") e avisam **"…e mais N"** com o link do painel; o **total** sempre considera o conjunto completo. As listas para **escolher** (editar/apagar) mostram os 10 mais recentes **até o fim do mês atual**: parcelas de meses futuros só aparecem em consulta de mês/período ou ao pedir "mostra as parcelas futuras".

### 4.6 No site

🖥️ Tela **Gastos** (página inicial do painel):

- **Seletor de mês** com setas ‹ › (abre sempre no mês atual).
- **Cartões-resumo:** Total do mês, Maior categoria, Número de gastos; e, se o cliente tem entradas no mês, **Entradas do mês** e **Saldo**; para cartões com limite informado, **Limite disponível** (ver módulos 7 e 9).
- **Dois gráficos de rosca:** gastos **por categoria** e **por forma de pagamento**, com valor e porcentagem.
- **Lista do mês** (data, descrição, categoria, forma de pagamento, valor) com **paginação**, **Editar** e **Excluir** (com confirmação).
- **Busca** por descrição em **todos os meses**, com filtro de **valor mínimo e máximo**.
- **Mudar a categoria em lote:** marque vários gastos e escolha a nova categoria.
- **+ Novo gasto** (valor com máscara de moeda, descrição, data, categoria, forma de pagamento).
- **Exportar CSV** de **todo o histórico** (data, descrição, categoria, forma de pagamento, valor), pensado para planilha ou imposto de renda.
- **Configurações no topo:** dia da semana do relatório semanal e o **aviso "não registrou nenhum gasto até HH:MM"** (ligar/desligar e escolher o horário).

---

## 5. Compras parceladas

💬 **Como registrar:** "comprei uma TV de 1500 em 3x", "parcelei o tênis em 6 vezes", "200 no cartão em 2x". Qualquer menção a parcelado/dividido/Nx indica compra parcelada.

**O que o assistente faz**

- Aceita o **valor total** ("1500 em 3x") **ou o valor de cada parcela** ("3 parcelas de 500"); se faltar algo (quantidade, valor, descrição, categoria, forma de pagamento), **pergunta só o que falta**.
- Cria **uma linha de gasto por parcela**, uma por mês, no mesmo dia (dia 31 em mês curto cai no último dia do mês). A descrição recebe a marca **"(parcela 3/6)"**.
- Se o valor total não divide exato, a **última parcela** ajusta os centavos e a mensagem avisa.
- Cada parcela aparece **no mês dela**: as de meses futuros não poluem as listas do mês atual, mas contam no total do mês em que vencem e entram na **agenda financeira** (módulo 15).

**Apagar:** ao apagar uma parcela, o assistente reconhece que é compra parcelada e pergunta se o cliente quer **apagar a compra inteira (todas as parcelas)**, com a confirmação de sempre (1 confirma / 3 cancela).

🖥️ **No site:** as parcelas aparecem como gastos normais no mês correspondente e podem ser editadas ou excluídas individualmente.

---

## 6. Categorias

**O que são.** Rótulos para agrupar gastos. Cada cliente tem as suas.

**Categorias iniciais:** Mercado, Veículo, Transporte, Saúde, Moradia, Lazer, Compras, Educação, Assinaturas, Outros.

💬 **No WhatsApp**

- **Ver:** "quais categorias eu tenho".
- **Criar:** "criar categoria Pets".
- **Renomear:** "renomeia a categoria Mercado para Supermercado" (os gastos continuam nela).
- **Juntar:** "junta a categoria Mercado com Supermercado": move os gastos e **apaga** a categoria de origem.
- **Apagar:** "exclui a categoria Viagem": os gastos **não** são apagados, ficam sem categoria.
- **Trocar a categoria de um gasto:** "muda a categoria do mercado para Lazer" ou "aquilo era carro, não mercado".
- **Trocar a categoria de vários gastos de uma vez:** "muda os gastos de hoje para Lazer", "muda os últimos 5 gastos para Mercado", "muda os gastos de Mercado para Lazer", "muda todo gasto com ifood para Alimentação". Pede confirmação.
- **Aprendizado:** quando o cliente corrige a categoria ou escolhe uma para uma palavra nova, o assistente guarda a palavra-chave e acerta sozinho nas próximas vezes.

🖥️ **No site:** tela **Categorias**: lista com nome editável e **orçamento mensal** editável (ver módulo 8), **+ Nova categoria** e **Excluir**.

---

## 7. Formas de pagamento e limite de cartão

**Formas iniciais:** Pix, Dinheiro, Cartão de crédito, Cartão de débito.

💬 **No WhatsApp**

- **Definir a padrão:** "meu pagamento padrão é pix" (usada quando o cliente não diz a forma).
- **Criar:** ao registrar um gasto, o cliente pode citar uma forma nova ("no cartão roxo"); o assistente a cria e oferece guardá-la como padrão.
- **Renomear:** "renomeia o cartão nubank para cartão roxo".

🖥️ **No site:** tela **Formas de pagamento**: nome editável, **limite do cartão** (opcional), botão **Tornar padrão**, **Excluir** e **+ Nova forma de pagamento**.

📏 **Regra do cartão:** é considerado "cartão" qualquer forma cujo nome cite cartão, crédito ou débito, ou que tenha limite informado. Gasto no cartão **não abate do saldo** (ele abate apenas do limite do cartão, se o cliente informou um limite). Ver módulo 9.

---

## 8. Orçamento mensal por categoria

**O que é.** Um teto de gasto por mês para uma categoria. O assistente avisa quando o cliente chega perto ou passa.

💬 **No WhatsApp**

- **Definir:** "me avisa se eu passar de 500 reais em lazer", "define um orçamento de 300 para mercado".
- **Consultar:** "quais orçamentos eu tenho", "qual o limite de mercado", "quanto ainda posso gastar em lazer" (mostra gasto do mês × limite).
- **Remover:** "tira o limite de lazer" (pede confirmação).
- **Avisos automáticos ao registrar um gasto da categoria:**
  - ao atingir **80%** do limite no mês: ⚠️ "Você já usou 85% do orçamento de Lazer este mês (R$ 85,00 de R$ 100,00)";
  - ao atingir **100%** ou mais: 🚨 "Você ultrapassou o orçamento de Lazer este mês…".

🖥️ **No site:** na tela **Categorias**, a coluna **Orçamento mensal (R$)** permite definir ou alterar; deixar em branco e salvar **remove** o limite.

---

## 9. Entradas (receitas) e saldo

**O que são.** Dinheiro que **entra** (salário, freela, reembolso, venda). Ficam separadas dos gastos.

💬 **No WhatsApp**

- **Registrar:** "recebi 3000 de salário", "entrou 500 de freela" (valor, descrição e data; sem data, vale hoje).
- **Consultar total:** "quanto recebi esse mês / essa semana / no mês passado / de 10 a 20 de agosto".
- **Listar:** "minhas entradas" (lista numerada com total).
- **Editar:** "muda o valor do 2 para 850", "muda o salário para 3500" (prévia 1/2/3). Edita valor, descrição e data.
- **Apagar:** "apaga o 2", "apaga a entrada do freela" (confirmação 1 apagar / 3 cancelar).
- **Saldo:** "qual meu saldo", "quanto sobrou esse mês" → **entradas − gastos que não são no cartão** do período.
- **Desfazer** vale para registro, edição e exclusão.

🖥️ **No site:** tela **Entradas**: seletor de mês, lista (data, descrição, valor), **+ Nova entrada**, **Editar**, **Excluir**, **Exportar CSV**. O total e o **Saldo** do mês aparecem também na tela de Gastos.

📏 **Regra do saldo:** Pix, dinheiro e gastos sem forma de pagamento abatem das entradas; **gastos no cartão não** (eles consomem o limite do cartão, quando informado). O site mostra "Limite disponível" por cartão com limite: *limite − gasto no mês no cartão*.

---

## 10. Gastos fixos (lançamento automático)

**O que são.** Despesas que se repetem **todo mês no mesmo dia** (internet, academia, aluguel) e que o assistente **lança sozinho**, sem o cliente avisar.

💬 **Cadastrar**

- Frases: "todo dia 10 pago 50 de internet", "cadastrar gasto fixo", "15 reais gasto fixo dia 10", "gasto fixo internet dia 10".
- O assistente **pergunta só o que falta** (nome, valor, dia) e mostra uma **prévia 1/2/3** antes de gravar.
- Se já existe um de nome igual ou parecido, **avisa** e oferece atualizar o existente.
- Se o dia do mês **já passou**, pergunta se lança **o deste mês agora** (datado do vencimento) ou só **a partir do mês que vem**.
- "Conta fixa" sem valor pergunta se é para **lançar sozinho** ou **só avisar** (nesse caso vira um alerta de conta, módulo 11).
- Uma recorrência "a cada 45 dias" vira **alerta de conta** (nunca gasto fixo).

💬 **Gerenciar**

- **Ver:** "quais gastos fixos eu tenho", "gastos fixos do mês".
- **Editar:** "muda o valor do gasto fixo da academia para 99,90", "o aluguel agora vence dia 8" (nome, valor, categoria, dia, forma de pagamento) com prévia 1/2/3.
- **Cancelar:** "cancela o gasto fixo da academia" (confirmação).
- O **desfazer** do cadastro o desativa.

**Lançamento automático**

- Todo dia, a partir das **7h**, o assistente lança os gastos fixos do dia e envia: *"🔁 Gasto fixo lançado: R$ 99,90 — Internet"* (com alerta de orçamento, se for o caso).
- Dia **29, 30 ou 31** em mês mais curto dispara no **último dia do mês**, e a mensagem avisa ("vence todo dia 31; hoje é o último dia do mês").
- **Se o servidor estava fora do ar**, o lançamento é **recuperado em até 7 dias**, com a data real do vencimento e o aviso "(lançado com atraso: vencia dia 05/10)". Nunca lança duas vezes o mesmo mês. Um gasto fixo cadastrado **depois** do vencimento não é lançado retroativamente.

🖥️ **No site:** não há tela de gastos fixos; os lançamentos aparecem como gastos normais (marcados como fixos) na tela Gastos. O cadastro e a gestão são pelo WhatsApp.

---

## 11. Contas fixas (alertas "já pagou?")

**O que são.** Lembretes recorrentes para algo que **o cliente mesmo faz** (pagar água, luz, cartão, comprar ração, trocar filtro). Diferente do gasto fixo, o assistente **não lança sozinho**: ele **pergunta se já foi feito**.

**Dois tipos de recorrência**

- **Por dia do mês:** "todo dia 5".
- **Por intervalo:** "a cada 45 dias" (a contagem **reinicia** quando o cliente confirma).

💬 **Cadastrar:** "me lembra de pagar a conta de água todo dia 5", "me lembra de comprar ração a cada 45 dias". Prévia 1/2/3, aviso de nome repetido, e o "desfazer" desativa o cadastro. Alertas não têm valor.

💬 **O aviso diário.** A partir das **8h** do dia certo, o assistente envia:

> 📌 Hora de: Conta de água.
> 1 ✅ Já resolvi · 2 ⏰ Ainda não, me lembra amanhã · 3 ⏭️ Não vou fazer agora (pular)

- **1:** o assistente pergunta o **valor** ("igual" repete o último, "pular" fecha sem lançar) e **lança o gasto de hoje** marcado como conta fixa; o ciclo é fechado.
- **2:** pergunta de novo **amanhã**.
- **3:** pula este mês/ciclo.
- Qualquer outro pedido do cliente é atendido normalmente e o aviso continua aberto. Resposta ambígua só repete as opções.
- **Regra dos 3 avisos:** se o cliente **não responde**, o aviso volta uma vez por dia, **no máximo 3 vezes**. O 3º traz "⚠️ Último aviso: se eu não tiver resposta, considero resolvido (sem lançar gasto) e te aviso de novo…". Na manhã seguinte o ciclo fecha sozinho, **sem lançar gasto**, e o alerta volta no próximo vencimento. Qualquer resposta, edição ou confirmação zera a contagem.
- **Recuperação:** se o servidor estava fora do ar no vencimento, o aviso sai atrasado, indicando "(atrasado: vencia dia 10/10)". Alerta cadastrado **depois** do vencimento não é avisado retroativamente.
- Dia **29/30/31** em mês curto avisa no último dia do mês.

💬 **Gerenciar:** "quais contas fixas eu tenho", "editar conta fixa" (lista os alertas, abre o menu: **Nome, Dia do mês, Intervalo** e, nos de intervalo, **Próximo aviso**) ou frase direta ("muda o alerta da água para o dia 8", "o alerta da ração agora é a cada 30 dias", "o próximo aviso da ração é dia 15/11"). Prévia antes → depois, aviso de nome repetido, confirmação 1/2/3 e desfazer. **Cancelar:** "cancela o alerta da água" (confirmação 1/3).

🖥️ **No site:** tela **Contas fixas** ("Alertas de contas fixas"): lista (alerta, recorrência, próximo aviso), **Novo alerta** (nome + repetir por dia do mês ou por intervalo), **Editar** e **Excluir**.

---

## 12. Agenda: eventos

**O que é.** Compromissos com dia, hora, local e aviso. A agenda é **própria do sistema**, guardada no banco de dados e isolada por número (**não** sincroniza com o Google Calendar).

💬 **Criar:** "marca dentista amanhã 15h", "reunião sexta às 10h". É preciso dizer **o dia e a hora**; se faltar um deles, o assistente pergunta só o que falta. O evento já nasce com **aviso padrão de 60 minutos antes** (configurável) e duração padrão de 1 hora.

💬 **Editar** (prévia 1/2/3 "antes → depois", valida data/hora):

- **Remarcar:** "muda a consulta para sexta às 16h", "muda só o dia da consulta para o dia 20", "a reunião de amanhã é às 15h".
- **Renomear:** "muda o nome da consulta para Dentista Dr. Paulo".
- **Local:** "a consulta é na Clínica Sorriso"; "tira o local da consulta".
- **Término/duração:** "a reunião vai até as 17h", "a reunião dura 2 horas". É possível esticar o término de um evento que **já começou**.
- **Aviso:** "me avisa 30 minutos antes da consulta em vez de 60" (aceita minutos, horas e dias; "na hora" = 0).
- **Avisos extras:** "quero ser avisado também 1 dia antes da consulta" adiciona outro aviso, **até 3 por evento**; "tira o aviso de 1 dia antes" remove só aquele (o evento precisa manter pelo menos 1).
- Várias mudanças na mesma frase viram uma só prévia, e a opção 2 deixa escolher qual corrigir.
- Se o novo horário já passou, a prévia avisa "⚠️ Esse horário já passou — não vou mandar aviso."

💬 **Cancelar:** "cancela a consulta do dia 15": mostra o compromisso e pergunta **1 cancela / 3 mantém**. Encontra também evento que **já começou** (e o que terminou há até 2 horas), marcado "· em andamento".

💬 **Avisos automáticos:** o assistente manda *"Daqui a 1 hora: …"* no WhatsApp no tempo configurado. O aviso só vale até 5 minutos depois do início (remarcar para o passado não dispara aviso), e editar só título, local ou texto **nunca reenvia** um aviso já enviado.

📏 **Dia inexistente:** pedir dia 31 em abril, 30/02 etc. leva ao **último dia do mês**, com aviso ("Abril só tem 30 dias, então marquei pro dia 30/04.").

🖥️ **No site:** tela **Agenda**:

- **Calendário do mês** com os eventos de cada dia (+ para criar direto no dia) e navegação por mês;
- **Destaque do dia selecionado** (hoje por padrão) com horário, título e local;
- **Próximos eventos** em lista, filtrável em **30, 60 ou 90 dias**, com Editar e Excluir;
- **+ Novo evento:** título, início, fim (opcional; padrão 1h depois), local (opcional) e **minutos de aviso**;
- **Aviso padrão antes dos eventos:** define quantos minutos antes o WhatsApp avisa nos eventos novos.

---

## 13. Lembretes

**O que são.** Mensagens que o assistente **envia de volta ao cliente** no WhatsApp **na hora marcada** (diferente do evento, que avisa antes).

💬 **Criar:** "me lembra de pagar a internet sexta às 9h", "me lembra de tomar remédio às 20h". Dia e horário são necessários; se faltar um, o assistente pergunta. O lembrete avisa **exatamente na hora** marcada. Se o cliente pedir "me avise 20 minutos antes", o assistente explica que isso existe só para **evento** e oferece transformar em evento.

💬 **Editar:** "muda o lembrete de pagar a internet para amanhã", "o lembrete do remédio é às 21h", "o lembrete agora é Pagar o boleto do carro" (data, hora e/ou texto) com prévia 1/2/3. Editar o horário de um lembrete **que já tocou** orienta a usar o adiar.

💬 **Adiar (soneca):** logo depois que um lembrete toca, o cliente pode dizer "adia 30 min", "me lembra de novo daqui a 1 hora", "adia pra amanhã 9h" (até 30 dias à frente).

💬 **Apagar:** "apaga o lembrete do remédio" (confirmação 1 apagar / 3 cancelar).

💬 **Consultar:** "meus lembretes" mostra os **próximos 10 pendentes**; "todos os meus lembretes" mostra os futuros (teto de 30 com link do painel). Ver também o módulo 14.

📏 O mesmo tratamento de **dia inexistente** da agenda vale aqui (31/04 → 30/04, com aviso).

🖥️ **No site:** tela **Lembretes**: lista (data/hora, mensagem, **status Pendente/Enviado**), **+ Novo lembrete**, **Editar**, **Excluir**.

---

## 14. Consulta da agenda e lista numerada

**O que é.** Perguntar "o que tenho" mostra **eventos e lembretes juntos**, por dia e em ordem de horário.

💬 **Como pedir**

| Pedido | Recorte |
|---|---|
| "o que tenho hoje", "e amanhã?", "agenda da sexta", "agenda do dia 20" | Um dia (mostra o dia inteiro; lembrete já enviado com ✔️; evento em andamento com "agora") |
| "agenda da semana" | Segunda a domingo (no meio da semana, só o restante) |
| "semana que vem" | Próxima semana |
| "próximos 15 dias", "o que tenho agendado" | Próximos N dias (padrão 7) |
| "agenda de novembro" | Mês inteiro |
| "eventos da semana", "lembretes de amanhã" | Filtra por tipo |
| "meus lembretes" / "todos os meus lembretes" | Lembretes pendentes (10 / todos os futuros) |

Resultado: itens **numerados em sequência contínua**, com horário (`09:00–10:00 Reunião · Sala 2`, `⏰ 14:00 Pagar boleto`), títulos truncados em 60 caracteres, teto de **30 itens** ("…e mais N. Veja tudo no painel").

💬 **Mexer pelo número** (logo após a lista, por 10 minutos): "edita o 2", "cancela o 3", "muda o 2 para 15h", "apaga o 5", "adia o 1 para amanhã às 9h", "me avisa também 1 dia antes do 4". O **tipo real do item** (evento ou lembrete) decide o fluxo, e tudo passa pelas mesmas confirmações e pelo desfazer.

🖥️ **No site:** a visão equivalente é a tela **Agenda** (calendário e próximos eventos) e a tela **Lembretes**.

---

## 15. Agenda financeira ("o que vence")

**O que é.** A visão do **futuro financeiro**: tudo que vai ser cobrado de hoje em diante, junto, por dia, com o **total previsto**. É **só consulta** (não altera nada).

💬 **Como pedir:** "agenda financeira", "o que vence essa semana", "contas a pagar", "o que tenho pra pagar em novembro", "próximas parcelas", "quanto vou pagar esse mês", "contas dos próximos 15 dias". Sem período, mostra os **próximos 30 dias**; aceita semana, mês, "próximos N dias" e um dia. Nunca mostra datas anteriores a hoje (exceto a seção "Em aberto").

**O que entra, e como aparece**

| Item | Linha | Observação |
|---|---|---|
| Gasto fixo | `🔁 Internet · R$ 99,90 (lança sozinho)` | Já lançado neste mês não aparece; mês seguinte sim |
| Conta fixa por dia do mês | `📌 Luz · ≈ R$ 150,00 (último)` ou `valor a informar` | O valor é o **último lançado** (estimativa); sem histórico, "valor a informar" |
| Conta fixa por intervalo | `📌 Ração · valor a informar (a cada 45 dias)` | Só a **próxima** data (as seguintes não se projetam) |
| Parcela de compra parcelada | `🧾 Tênis · parcela 3/6 · R$ 120,00` | A parcela de hoje já é gasto lançado e não entra |
| Gasto com data futura | `🧾 Dentista · R$ 200,00 (lançamento futuro)` | |

- **⚠️ Em aberto** (no topo): contas cujo vencimento **já passou sem resposta** (ex.: "Luz · venceu dia 10, aguardando sua resposta (2 de 3 avisos)") e gasto fixo recente que o servidor ainda não lançou. **Não entram no total.**
- No fim: **"Total previsto: R$ X"** e, se houver, "+ N sem valor definido".
- Mais de 30 itens: as 30 primeiras linhas e o link do painel; o total soma tudo.
- Sem nada a pagar: "Nada a pagar neste período. 🎉".
- A consulta **não** gera lista numerada e invalida a lista numerada anterior.

📏 Não confundir com **"quanto gastei este mês"**, que soma o que **já foi gasto**.

🖥️ **No site:** ainda não existe tela da agenda financeira; é uma consulta do WhatsApp.

---

## 16. Relatórios e avisos automáticos

O assistente também **toma a iniciativa** de falar com o cliente:

| Mensagem | Quando | Conteúdo | Como configurar |
|---|---|---|---|
| **Relatório semanal** | Toda **sexta às 9h** (dia ajustável) | Resumo de gastos da semana: total, quantidade, comparação com a semana anterior e total por categoria. **Sem nenhum gasto no período, nada é enviado** (o mesmo vale para o mensal) | WhatsApp: "quero receber toda quarta"; Site: seletor "Relatório semanal toda…" |
| **Relatório mensal** | **Último dia do mês às 18h** | Mesmo resumo para o mês inteiro | Ativado junto com o relatório semanal |
| **Aviso de gasto pendente** | Todo dia às **18h30** (horário ajustável), **só se o cliente não registrou nenhum gasto no dia** | Pergunta se esqueceu de registrar algo | WhatsApp: "desativa o aviso de gasto pendente", "muda o horário do aviso de gasto para 20h"; Site: ligar/desligar e horário |
| **Aviso de evento** | No tempo configurado antes de cada evento (padrão 60 min) | "Daqui a 1 hora: …" | WhatsApp/site (por evento ou padrão) |
| **Lembrete** | Na hora marcada | O texto do lembrete | Criar/editar lembretes |
| **Gasto fixo lançado** | Dias de vencimento, a partir das 7h | "🔁 Gasto fixo lançado: …" | Módulo 10 |
| **Alerta de conta fixa** | Dias de vencimento, a partir das 8h | "📌 Hora de: …" com 1/2/3 | Módulo 11 |
| **Alerta de orçamento** | Ao registrar um gasto que cruza 80% ou 100% | ⚠️/🚨 anexado à confirmação | Módulo 8 |

📏 O administrador pode limitar **em quais dias da semana** o aviso de gasto pendente pode ser enviado para todos os clientes (ver módulo 18).

---

## 17. Painel do cliente (site): acesso e navegação

### 17.1 Entrar

🖥️ A tela de login pede o **número de WhatsApp (DDD + número)** e a **senha**.

- **Primeiro acesso / esqueci a senha:** o cliente digita o número e clica para receber a senha; o sistema **envia uma senha nova por WhatsApp** (só se o número estiver autorizado). A resposta na tela é **sempre a mesma**, exista conta ou não, para ninguém descobrir quais números são clientes.
- A senha é **sempre gerada pelo sistema**; pode ser pedida **uma vez por hora**. O administrador pode redefinir a qualquer momento (módulo 18).
- **Segurança:** depois de **5 tentativas erradas**, o acesso fica bloqueado por 15 minutos. A sessão dura **30 dias** em cada aparelho. **Sair** encerra a sessão.

### 17.2 Navegação

Menu superior com sete áreas (no celular vira menu "☰"):

| Aba | O que faz | Módulo |
|---|---|---|
| **Gastos** | Painel do mês, gráficos, lista, busca, CSV, configurações de relatório e aviso | 4 |
| **Entradas** | Receitas do mês, CSV | 9 |
| **Categorias** | Categorias e orçamento mensal | 6 e 8 |
| **Formas de pagamento** | Formas, limite de cartão, padrão | 7 |
| **Agenda** | Calendário, eventos, aviso padrão | 12 |
| **Lembretes** | Lista e edição de lembretes | 13 |
| **Contas fixas** | Alertas de contas fixas | 11 |

O topo mostra o número do cliente e o botão **Sair**.

### 17.3 Instalar como aplicativo

O painel é um **aplicativo web instalável (PWA)**: no celular, pode ser adicionado à tela inicial, com ícone "Organizaí", abrindo em tela cheia. Tem layout adaptado a telas pequenas (tabelas viram cartões).

### 17.4 O que o site não tem

Não há no site: cadastro/edição de **gastos fixos**, **agenda financeira**, relatórios sob demanda e "desfazer". Esses recursos existem no WhatsApp.

---

## 18. Painel do administrador (site)

Acesso exclusivo do dono, com **usuário e senha** próprios e as mesmas proteções contra tentativas repetidas (sessão de 7 dias). Tudo em uma única página, em seções:

### 18.1 Avisos de saúde (topo)

- **Faixa vermelha** se o banco de dados **não está em volume persistente** (os dados se perderiam a cada nova versão do sistema): mostra o caminho do banco e o passo de correção no servidor. Um volume montado em outro caminho só gera uma linha informativa, sem alarme.
- **Aviso de banco novo:** se o banco foi criado vazio na última subida (primeira instalação ou caminho trocado), o painel e o dono (WhatsApp) são avisados para conferir se os dados esperados não ficaram no caminho antigo.
- Linha discreta "Banco: … volume persistente verificado" quando está tudo certo.

### 18.2 Clientes e cobrança

Controle **manual** de mensalidades (sem gateway de pagamento):

- Por cliente: **mensalidade, vencimento, status** (Sem cobrança / **Em dia** / **Atrasado**), **último pagamento** e **histórico de meses pagos**.
- **Planos fixos:** mensal **R$ 19,90** ou anual **R$ 179,90**. Botões **Pago mensal** / **Pago anual** reiniciam o vencimento a partir de hoje (+1 mês ou +12 meses) e gravam os meses no histórico.
- **Revogar acesso:** tira o cliente da lista de autorizados na hora.
- **+ Novo cliente (conceder acesso):** autoriza um número.

### 18.3 Contas do painel

Lista de quem tem acesso ao site (número, criada em, última senha enviada), com **Redefinir senha** (envia nova senha por WhatsApp, sem esperar a hora de carência), **Tirar acesso** (apaga a conta e derruba as sessões; **não** retira o cliente do assistente) e formulário "Mandar senha". Senhas **nunca** são digitadas pelo administrador.

### 18.4 Números autorizados

Lista de quem pode usar o assistente, com **nota**, **data de autorização**, **Remover**, e a coluna **Média de mensagens/mês** (cliente + assistente). Para não enganar, a tela informa **desde quando a contagem existe** ("Contagem de mensagens iniciada em 20/10/2026; não há histórico anterior"): número sem mensagens mostra **0**; com menos de 30 dias de contagem mostra **total e período** ("42 em 5 dias", com "cliente X · bot Y"); a partir de 30 dias mostra a **média por mês**. Quando a data de início é aproximada (marcada com `~`), a média mensal só aparece depois de 30 dias garantidos; antes disso a célula mostra "N em até X dias".

### 18.5 Tentativas bloqueadas

Lista das mensagens de **números não autorizados** (quando, número, trecho da mensagem), com botões **Aprovar** (autoriza) e **Bloquear**.

### 18.6 Números bloqueados

Lista de bloqueados com **Desbloquear** (desbloquear **não** autoriza de volta) e formulário **Bloquear número**.

### 18.7 Ferramentas

- **Testar relatório semanal:** envia o relatório da semana passada para um número, agora, só para conferir.
- **Aviso de gasto pendente, dias da semana:** escolhe em quais dias o aviso automático pode ser enviado para todos.

### 18.8 Acompanhamento do sistema

- **Lembretes pendentes:** os próximos lembretes de todos os clientes (quando, para quem, mensagem).
- **Rotinas agendadas:** as últimas 30 execuções das rotinas automáticas (nome legível, dia, início, fim, status — concluída, em andamento, falhou, perdida —, itens e tentativas) e os **períodos em que o servidor ficou fora do ar**; mostra também por quantos dias o log de atividade é guardado.
- **Atividade recente:** o registro do que o assistente fez (tipo, número, resumo), com **paginação** (de 10 em 10 por padrão, ajustável até 100 por página).

### 18.9 Sprints (Kanban)

Página separada (**📋 Sprints**) para organizar o desenvolvimento do próprio sistema: cada pedido vira um **card** (tipo **melhoria, evolução ou incidente**) em um quadro com seis colunas — **Backlog, Refinado, A fazer, Fazendo, Testando, Feito**. É possível criar, editar, mover e excluir cards, ajustar a data de fim do sprint (padrão 10 dias) e encerrar o sprint.

---

## 19. Rotinas automáticas e confiabilidade

### 19.1 Rotinas diárias

| Rotina | Horário | O que faz |
|---|---|---|
| Limpeza do log de atividade | 03:00 | Apaga registros do log mais antigos que o prazo de retenção |
| Gastos fixos | 07:00 | Lança os gastos fixos do dia e avisa o cliente |
| Alertas de conta | 08:00 | Pergunta "já fez?" nas contas fixas do dia (até 3 avisos) |
| Relatório semanal | 09:00 (dia escolhido pelo cliente) | Envia o resumo da semana |
| Relatório mensal | 18:00 no último dia do mês | Envia o resumo do mês |
| Aviso de gasto pendente | 18:30 (ajustável por cliente) | Avisa quem não registrou nenhum gasto no dia |
| Lembretes e avisos de evento | Conferidos a cada minuto | Enviam na hora certa |

### 19.2 Recuperação de falhas

Se o servidor ficar fora do ar (queda, deploy), ao voltar ele **recupera o que perdeu sem duplicar**:

- **Gasto fixo:** recupera até 7 dias, com a data real do vencimento e a nota "(lançado com atraso)".
- **Alerta de conta:** avisa o ciclo pendente, indicando o atraso.
- **Lembretes e eventos:** envia os que ainda valem, indicando que estão atrasados (aviso de evento só até 5 minutos após o início).
- **Relatórios:** só no mesmo dia (relatório antigo nunca sai); uma execução abandonada **não** é repetida.
- Se o envio falhar (WhatsApp fora do ar), a rotina **tenta de novo no minuto seguinte, no máximo 3 vezes por dia**, sem enviar duas vezes a quem já recebeu.
- Cada execução fica registrada (e aparece no painel do administrador). Quedas maiores que 5 minutos viram um aviso "servidor fora do ar de … a …" no log do dono.

### 19.3 Persistência das conversas

As confirmações em andamento (1/2/3, menus, listas de escolha) são guardadas e **sobrevivem a reinício do servidor** por 10 minutos. A "última lista mostrada" (para "edita o 2") fica em memória e se perde num reinício; o assistente então mostra os itens recentes para escolher.

### 19.4 Retenção do log de atividade

O log de atividade (usado no painel do administrador) é guardado por **90 dias** por padrão; o administrador do servidor pode mudar o prazo ou desligar a limpeza (0 = nunca apagar). A limpeza vale para todos os tipos de registro, inclusive tentativas bloqueadas e quedas.

### 19.5 Dados e volume persistente

Todos os dados ficam em um banco local (SQLite). Para sobreviverem a cada nova versão do sistema, o banco precisa estar num **volume persistente** do servidor. O sistema **verifica isso ao iniciar**: se não houver volume, avisa o dono por WhatsApp (no máximo uma vez por hora) e mostra a faixa vermelha no painel do administrador. Criar o volume é uma ação manual no servidor.

---

## 20. Limites e o que o sistema ainda não faz

**Limites atuais**

- Valor máximo de um lançamento: **R$ 1.000.000,00**.
- Edição: até **6 mudanças** por gasto e **5 gastos** por mensagem.
- Consultas em intervalo: até **366 dias**; agenda: até **365 dias**.
- Listas: **30 linhas** (20 em "últimas N"); listas para escolher: **10** itens.
- Cada evento: até **3 avisos**; adiar lembrete: até **30 dias**.
- Confirmações e números de lista valem **10 minutos**.
- Freio de segurança: mais de **20 mensagens em 5 minutos** pausa o número por 30 minutos.
- Lembretes exatamente na hora (não existe "avisar antes" para lembrete; use evento).

**Ainda não existe**

- Sincronização com **Google Calendar** (a agenda é própria do sistema).
- **Faturas de cartão** como cadastro próprio (hoje o cartão é só uma forma de pagamento com limite opcional).
- **Investimentos** e **recebimentos futuros** previstos.
- **Cobrança automática** (pagamentos dos clientes são marcados manualmente no painel do administrador).
- Telas no site para **gastos fixos** e **agenda financeira** (funcionam só no WhatsApp).
- Pagar, editar ou apagar itens **a partir** da lista da agenda financeira.
- Lista "minhas compras parceladas" com parcelas pagas e restantes.
- Resumo financeiro semanal automático da agenda financeira.
- Cópia de segurança diária do banco para outro armazenamento.

---

## 21. Anexos

### 21.1 Exemplos rápidos de frases

| Quero… | Digo… |
|---|---|
| Registrar gasto | "gastei 50 no mercado", "uber 30 no pix" |
| Registrar entrada | "recebi 3000 de salário" |
| Gasto parcelado | "comprei uma TV de 1500 em 3x" |
| Cadastrar gasto fixo | "todo dia 10 pago 50 de internet" |
| Cadastrar alerta de conta | "me lembra de pagar a água todo dia 5" |
| Orçamento | "me avisa se eu passar de 500 em lazer" |
| Ver gastos | "quanto gastei esse mês", "mostra as 10 últimas compras" |
| Ver saldo | "qual meu saldo" |
| Ver o que vence | "o que vence essa semana", "contas a pagar em novembro" |
| Marcar compromisso | "marca dentista amanhã 15h" |
| Criar lembrete | "me lembra de tomar remédio às 20h" |
| Ver agenda | "o que tenho hoje", "agenda da semana" |
| Editar pelo número | "edita o 2", "muda o 3 para 45", "cancela o 4" |
| Adiar lembrete que tocou | "adia 30 min" |
| Desfazer | "desfaz isso" |
| Cancelar o que está pendente | "cancelar" |
| Pedir ajuda | "ajuda", "como mexo na agenda" |

### 21.2 Glossário

- **Gasto:** dinheiro que saiu. **Entrada:** dinheiro que entrou.
- **Gasto fixo:** despesa mensal que o assistente **lança sozinho**.
- **Conta fixa / alerta de conta:** lembrete recorrente em que o assistente **pergunta** se o cliente já fez.
- **Evento:** compromisso com hora e aviso **antes**. **Lembrete:** mensagem enviada **na hora marcada**.
- **Prévia:** resumo mostrado antes de gravar uma mudança, com opções 1/2/3.
- **Ciclo (de um alerta):** o vencimento da vez (um mês, ou um intervalo).
- **Painel do cliente:** site do cliente. **Painel do administrador:** site do dono do sistema.
- **Volume persistente:** área do servidor que preserva os dados entre versões.
