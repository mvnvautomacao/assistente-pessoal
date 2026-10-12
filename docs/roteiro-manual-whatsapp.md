# Roteiro manual de teste no WhatsApp — Cards 1 a 7

Para quem **não** leu o código. Cada passo diz o que **enviar** (→) e o que o bot deve **responder** (←). O texto do bot pode variar em detalhes de data e valor; o que importa está em **negrito**. Use um número de teste autorizado no `/admin`, de preferência um que não seja o seu de uso diário.

**Antes de começar (preparação, ~2 min). Mande estas mensagens, uma por vez, e espere a confirmação de cada uma:**

1. `gastei 38 no mercado no pix`
2. `gastei 20 de uber no dinheiro`
3. `gastei 12 de padaria no pix`
4. `recebi 3000 de salário`
5. `recebi 800 de freela`
6. `marca consulta dentista daqui a 3 dias às 14h`
7. `marca reunião cliente daqui a 4 dias às 10h`
8. `me lembra de pagar a luz amanhã às 9h`
9. `gasto fixo de academia, 89,90, todo dia 5`

**Regras gerais do roteiro**
- "Pendência" = o bot ficou esperando você responder. Responder **cancelar** sempre sai.
- Se um passo não bater, anote o número do passo e a resposta recebida (um print ajuda) e siga para o próximo cenário.
- As janelas de tempo (10 minutos, 60 minutos) são reais: o cenário 7.2 exige esperar.

---

## Card 1 — Confirmação de edição (1 confirmar · 2 corrigir · 3 cancelar)

### 1.1 Prévia "antes → depois" de gasto
1. → `muda o valor do mercado pra 45`
   ← **mostra o gasto, "Valor: R$ 38,00 → R$ 45,00" e as três opções "1 ✅ Confirmar / 2 ✏️ Corrigir / 3 ❌ Cancelar"**. Nada foi alterado ainda (confira com `quais gastos eu tive hoje`).
2. → `1`
   ← **`✏️ "mercado" atualizado: valor R$ 45,00.` e, na linha de baixo, `Errou? Responde *desfazer*.`**

### 1.2 Respostas que NÃO devem confirmar nem cancelar sozinhas
1. → `muda a reunião cliente pra sexta`
   ← prévia do evento com as 3 opções.
2. → `pode ser às 16h`
   ← **nova prévia com o horário 16:00 (é uma correção). Não confirmou, não cancelou.**
3. → `3`
   ← `Beleza, não mexi em nada.`

### 1.3 Corrigir (opção 2) e resposta inválida
1. → `muda o uber pra 25` → ← prévia.
2. → `2`
   ← **`Qual é o valor certo? (ex: 45 ou 45,90) Ou responde *cancelar*.`**
3. → `abc`
   ← **repete a pergunta explicando que não entendeu o valor.**
4. → `3`
   ← **a prévia mostra R$ 3,00 (o "3" aqui é o valor, não "cancelar").**
5. → `cancelar` → ← `Beleza, não mexi em nada.`

### 1.4 Validações antes da prévia
- → `muda o valor da padaria pra 0` ← **`O valor precisa ser maior que R$ 0,00.`** (sem prévia)
- → `muda o valor da padaria pra 2000000` ← **`Esse valor é muito alto (limite R$ 1.000.000,00). Confere e me manda de novo?`**
- → `muda o valor da padaria pra 12` ← **`Já está assim, não mexi em nada.`**

### 1.5 Resposta sem sentido
1. → `muda a padaria pra 14` (prévia). 2. → `talvez` ← **`Não entendi 🤔 Responde *1* pra confirmar, *2* pra corrigir ou *3* pra cancelar.`** 3. → `3`.

---

## Card 2 — Escolher o item certo por número

### 2.1 Gasto com mais de um candidato
1. → `gastei 15 no mercado` (cria um segundo "mercado")
2. → `muda o valor do mercado pra 50`
   ← **lista `Achei 2 gastos com "mercado":` com `1.` e `2.` (valor, data e pagamento) e `Qual deles você quer editar? Responde com o número ou *cancelar*.`**
3. → `2`
   ← **vai direto para a prévia do gasto escolhido, sem você repetir o pedido.**
4. → `3`.

### 2.2 Número inválido, refino, cancelar
1. Repita 2.1 até a lista. → `9` ← **`Não entendi 🤔 Responde com um número de 1 a 2, ou *cancelar*.`** (a lista continua)
2. → `cancelar` ← `Beleza, não mexi em nada.`

### 2.3 Nenhum candidato
- → `muda o evento zebra pra amanhã` ← **`Não encontrei nenhum evento futuro parecido com "zebra".`**
- → `muda o lembrete zebra pra amanhã` ← **`Não encontrei nenhum lembrete parecido com "zebra".`**

### 2.4 Pedido novo descarta a lista
1. Abra a lista de 2.1. 2. → `muda o valor da padaria pra 13 por favor`
   ← **`Cancelei a escolha anterior e entendi seu novo pedido.` e, em seguida, a prévia da padaria.** 3. → `3`.

---

## Card 3 — Vários campos e vários gastos numa mensagem

### 3.1 Vários campos de um gasto
1. → `muda o uber pra 30, categoria lazer-teste e pagamento pix`
   ← **uma prévia com `Valor`, `Categoria: ... → lazer-teste (nova)` e `Pagamento`.**
2. → `3` (cancela) → confira com `quais categorias eu tenho` que **`lazer-teste` NÃO foi criada**.
3. Repita o passo 1 e → `1` ← **sucesso com "Errou? Responde *desfazer*."**; agora `lazer-teste` existe.

### 3.2 Dois gastos, uma confirmação, um desfazer
1. → `o mercado foi no dinheiro e o uber no pix`
   ← **`✏️ Vou fazer 2 alterações:` com as duas linhas e `1 ✅ Confirmar tudo`.**
2. → `1` ← **`✏️ 2 gastos atualizados.`**
3. → `desfaz isso` ← **`desfiz as alterações em 2 gasto(s)`** (os dois voltam).

### 3.3 Mais de 5 gastos (opcional)
Cadastre antes 6 gastos com nomes bem diferentes (`gastei 5 em abacate`, `... em banana`, `... em cenoura`, `... em damasco`, `... em espinafre`, `... em figo`).
- → `muda abacate, banana, cenoura, damasco, espinafre e figo pra 9` ← **`Faço até 5 alterações por vez. Me manda as primeiras 5 e depois as outras.`** (nada é alterado)

### 3.4 Opção 2 com várias mudanças
1. → `muda o uber pra 31 e pix` (prévia com 2 linhas). 2. → `2`
   ← **`Qual você quer corrigir?` com `1 Valor` e `2 Pagamento`.**
3. → `1` ← pergunta do valor. 4. → `32` ← prévia só com o valor corrigido. 5. → `3`.

---

## Card 4 — Menu guiado de campos

### 4.1 Gasto pelo "editar"
1. → `editar` ← **`O que você quer editar?` com 8 opções (1 Gasto ... 8 Entrada).**
2. → `1` ← **lista numerada dos últimos gastos ("Seus últimos gastos:").**
3. → `1` ← **`✏️ <gasto> ...` + `O que você quer mudar?` + `1 Valor / 2 Nome / 3 Categoria / 4 Data / 5 Pagamento`.**
4. → `1 e 5` ← **`(1 de 2) Qual é o valor certo?...`**
5. → `45` ← **`(2 de 2) Qual forma de pagamento?` com lista numerada.**
6. → `Pix` ← **prévia com Valor e Pagamento.** 7. → `1` ← sucesso + desfazer.

### 4.2 Respostas erradas no menu
1. Abra o menu (4.1 até o passo 3). → `1 e 9` ← **`Não entendi 🤔 Responde com os números das opções (ex: 1 e 3) ou *cancelar*.`** (menu continua)
2. → `valor` → ← pergunta do valor. → `abc` ← **repete a pergunta com o motivo.** → `cancelar` ← **`Beleza, não mexi em nada.`**

### 4.3 "1 e 5" na LISTA (e não no menu)
1. → `editar`, `1` (aparece a lista de gastos). 2. → `1 e 5`
   ← **`Escolhe um item por vez: responde só um número de 1 a N, ou *cancelar*. Depois eu mostro o que dá pra mudar.`** (a lista continua) 3. → `cancelar`.

### 4.4 Edição sem dizer o que mudar
- → `edita o mercado` ← **menu do gasto (ou lista, se houver 2 "mercado").**
- → `edita a consulta` ← **menu do evento com 5 opções (Dia e hora, Título, Aviso, Término, Local).**
- → `edita o gasto fixo da academia` ← **menu com 5 campos (Nome, Valor, Categoria, Dia do mês, Pagamento).** → `cancelar`.

### 4.5 Gasto fixo: categoria nova só no "1"
1. → `edita o gasto fixo da academia` → `3` → `Fitness teste` ← **prévia com `Categoria: ... → Fitness teste (nova)`.**
2. → `3` (cancela) → `quais categorias eu tenho` ← **"Fitness teste" NÃO existe.**

---

## Card 5 — Entradas

### 5.1 Listar, editar e saldo
1. → `minhas entradas` ← **lista numerada (`1. freela...`, `2. salário...`) e `💰 Total: R$ 3.800,00`.**
2. → `muda o valor do 2 pra 3500` ← **prévia `Valor: R$ 3.000,00 → R$ 3.500,00`.**
3. → `1` ← **`✏️ Entrada "salário" atualizada: valor R$ 3.500,00.` + desfazer.**
4. → `qual meu saldo esse mês` ← **o saldo já usa R$ 3.500.**
5. → `desfaz isso` ← **volta para R$ 3.000.**

### 5.2 Apagar
1. → `minhas entradas`, depois `apaga o 2` ← **`🗑️ Vou apagar a entrada: ...` + `1 ✅ Apagar` e `3 ❌ Cancelar`.**
2. → `2` ← **`Não entendi 🤔 Responde *1* pra apagar ou *3* pra cancelar.`** (pendência continua)
3. → `3` ← `Beleza, não mexi em nada.`
4. Repita o passo 1 e → `1` ← **`🗑️ Entrada "..." apagada.` + desfazer.** → `desfaz isso` ← **a entrada volta com o mesmo valor e data.**

### 5.3 Guiado e por texto
- → `editar`, `8`, `1`, `1 e 3`, `3500`, `ontem`, `1` ← **entrada com valor 3.500 e data de ontem.**
- → `recebi 100 de presente` ← **continua registrando uma entrada nova** (`💵 Entrada registrada`).

---

## Card 6 — Agenda

### 6.1 Local e término do evento
1. → `a consulta é na Clínica Sorriso` ← **prévia `Local: sem local → Clínica Sorriso`** → `1`.
2. → `a consulta vai até as 16h30` ← **`Término: 15:00 → 16:30`** → `1`. (O cabeçalho agora mostra `· Clínica Sorriso`.)
3. → `a consulta dura 2 horas` ← **término às 16:00** → `3`.
4. → `a consulta vai até as 13h` ← **`O término precisa ser depois do início (14:00).`**
5. → `tira o local da consulta` ← **`Local: Clínica Sorriso → sem local`** → `1` → `desfaz isso` (o local volta).

### 6.2 Correção com duas mudanças no evento
1. → `a reunião cliente vai até as 17h na sala 2` ← prévia com `Término` e `Local`.
2. → `2` ← **`Qual você quer corrigir?` `1 Término` `2 Local`.** → `2` → `Sala 3` ← **só o local muda na nova prévia.** → `3`.

### 6.3 Aviso que não se repete
- Aguarde um evento já avisado ("Daqui a 1 hora...") e **só renomeie** (`renomeia a consulta pra Dentista`): **o aviso não volta.** Mudar o **horário** do evento reagenda o aviso.

### 6.4 Adiar lembrete que já tocou
1. Espere o lembrete da luz tocar. **O toque vem com a linha `Pra adiar, responde "adia 30 min" ou "adia pra amanhã 9h".`**
2. → `adia 30 min` ← **`⏰ Adiado! Te lembro de "..." de novo às HH:MM (daqui a 30 min). Errou? Responde *desfazer*.`** (o horário é agora + 30 min)
3. → `desfaz isso` ← **`desfiz o adiamento`; o lembrete NÃO toca de novo.**
4. → `adia pra amanhã` ← mesma hora do lembrete, no dia seguinte.
5. → `adia 0 min` ← **`Esse horário já passou. Me diz um horário futuro, ex: daqui a 30 min ou amanhã 9h.`**
6. Sem nenhum lembrete tocado há pouco, → `adia 30 min` ← **`Não achei nenhum lembrete que tenha tocado agora há pouco. Diga o nome dele, ex: "adia o remédio pra amanhã 9h".`**

### 6.5 Lembrete que já tocou, tentando editar
- → `muda o lembrete da luz pra 9h` ← **`O lembrete "..." já tocou (...). Pra tocar de novo, diga "adia o remédio pra amanhã 9h".`**

---

## Card 7 — Pendências que sobrevivem a reinício + expiração

### 7.1 Reinício (peça para quem opera o servidor)
1. → `muda o valor do uber pra 33` (prévia aberta). 2. **Reinicie/redeploy o servidor.** 3. → `1`
   ← **a edição é aplicada normalmente** (antes do Card 7 o bot perdia a conversa).
4. → `editar` e `1` (lista aberta), reinicie, → `2` ← **abre o menu do gasto.**
5. Aplique uma edição, reinicie, → `desfaz isso` ← **desfeito.**

### 7.2 Expiração (espere 11 minutos sem responder)
1. → `muda o valor do uber pra 34` (prévia). 2. **Espere 11 min.** 3. → `1`
   ← **`⌛ A confirmação de "uber — R$ ..." expirou (passaram mais de 10 minutos) e eu não mexi em nada. Se ainda quiser, é só pedir de novo.`** (gasto inalterado)
4. → `1` de novo ← **sem repetir o aviso** (mensagem normal ou nenhuma).
5. Abra uma lista de escolha (2.1), espere 11 min, → `2` ← **`⌛ A lista de opções expirou ...`**
6. Aplique uma edição, espere 11 min, → `desfaz isso` ← **`⌛ O prazo pra desfazer "..." já passou (10 minutos)...`**
7. Abra uma prévia, espere 11 min, → `muda o valor do uber pra 35 por favor` ← **processa normalmente, sem aviso de expiração.**

### 7.3 Dica de desfazer
- Toda mensagem de sucesso de edição, apagar entrada, adiar e criar gasto/evento/lembrete termina com **`Errou? Responde *desfazer*.` uma vez só**.

---

## Interações entre cards

### I-a Lista → menu → prévia → confirmar → desfazer, com reinício
Faça 2.1 até a lista, **reinicie**, `2`, **reinicie**, `1`, **reinicie**, `45`, **reinicie**, `1`, **reinicie**, `desfaz isso`. **Cada passo continua do ponto onde parou.**

### I-b Pendência aberta + pedido novo
1. Prévia aberta de gasto. 2. → `renomeia a reunião cliente para reunião nova com a diretoria`
   ← **`Cancelei a alteração de "..." e entendi seu novo pedido.` e a prévia do evento.**
3. ⚠️ **Defeito conhecido D-07:** com a prévia aberta, → `gastei 30 de café` responde só `Não entendi 🤔 Responde *1*...` (não registra). Saída: `cancelar`.
4. ⚠️ **Defeito conhecido D-01:** → `cancela a reunião cliente e renomeia a reunião cliente para x` deixa DUAS perguntas abertas (cuidado: responder `sim` cancela o evento). Responda `cancelar` para limpar.

### I-c Dois números ao mesmo tempo
- Com dois celulares, abra uma prévia em cada um e responda `1` num e `3` no outro quase juntos. **Cada resposta vale só para a prévia do próprio número.**

### I-d "cancelar" com pendência
- Para cada pendência (prévia, menu, lista, "editar"): → `cancelar` ← **`Beleza, não mexi em nada.`** (ou `Beleza, cancelei o que estava pendente...`). Nenhuma alteração. ⚠️ `" cancelar "` com espaços dá a segunda frase (D-03, só o texto).

### I-e Evento com vários campos + correção
- → `remarca a consulta pra daqui 5 dias, vai até as 17h, na Clínica B e renomeia pra Dentista` ← **prévia com `Quando`, `Término`, `Nome`, `Local`.** → `2` ← **`Qual você quer corrigir?` com 4 opções.** → `1` → `daqui a 6 dias` ← **só o dia muda; término 17:00, nome e local continuam.** → `1` → `desfaz isso` ← **tudo volta.**

### I-f Lista antiga depois de reinício
- → `gastos de hoje`, **reinicie**, → `edita o 2 pra 99` ← **`Essa lista já expirou, então não vou adivinhar pelo número. Seus últimos gastos:`** (limitação conhecida: a lista de gastos fica só em memória).

### I-g Duas edições seguidas, desfazer
- Edite o valor do uber duas vezes seguidas (`pra 20`, `1`, `pra 30`, `1`). → `desfaz isso` ← **volta para 20.** → `desfaz isso` ← **`Não tem nada recente pra eu desfazer.`**

### I-h Áudio, acento, emoji
- Com uma prévia aberta: mande um **áudio dizendo "sim"** ← **aplica**. Com outra prévia: `Sím` ← **aplica**; `👍` ← **aplica**; `❌` ← **cancela**.
- ⚠️ **Defeito conhecido D-04:** áudio dizendo "um" / "dois" / "três" **não** responde à prévia (responde `Não entendi 🤔`). Na lista numerada e no menu de campos, "um/dois" **funcionam**.

---

## Se algo não bater
Registre: número do passo, a mensagem enviada, a resposta recebida e o horário. Defeitos já conhecidos estão em `docs/auditoria-cards-1-a-7.md` (seção 6, D-01 a D-13).
