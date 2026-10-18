# Auditoria das entregas dos Cards 1 a 7

- **Data:** 2026-10-11 · **Commit auditado:** `d0eb68d` (branch `develop`, igual à `main`)
- **Escopo do código:** commits `fdde833` (Card 1), `8c33a4f` (Card 2), `fc10094` (Card 3), `e33a347` (Card 4), `2ed554d` (correção do "1 e 5" na lista, parte do Card 4), `00105b0` (Card 5), `64a61cd` (Card 6), `d0eb68d` (Card 7).
- **Regra cumprida:** nenhuma alteração em `src/` (`git diff --stat -- src` vazio). Só `test/` e `docs/`.
- **Ressalva de independência:** a premissa do card pedia uma sessão sem o contexto de implementação. Esta auditoria foi feita na **mesma sessão** que implementou os cards 1 a 7. Para compensar, nenhum item foi marcado como atendido por descrição de commit: cada status vem de leitura do código, de teste que asserta o comportamento ou de execução de cenário novo. Os achados mais valiosos (D-01, D-04, D-05, D-06) vieram de executar cenários, não de reler o que foi feito; mesmo assim vale uma segunda revisão humana dos itens "Parcial".

---

## 1. Resumo executivo

1. Os 7 cards estão **funcionalmente entregues**: dos 66 itens do checklist, 60 estão Atendidos com teste que asserta o comportamento (9 deles só porque esta auditoria acrescentou o teste que faltava), 2 Parciais, 3 Não atendidos e 1 Não verificável; todos os que não estão Atendidos se ligam a defeitos listados abaixo.
2. **Sem perda de dados nem vazamento entre números** nos cenários exercitados. Toda consulta nova filtra por `from_number`/`to_number` (conferido por leitura e por teste).
3. O defeito mais sério é **D-01 (Alto)**: numa mesma mensagem, um pedido de **apagar** (evento, gasto, lembrete...) junto com um pedido de **editar** deixa duas perguntas abertas com instruções conflitantes; responder "1" à prévia de edição cai na pergunta antiga "sim/não" de exclusão.
4. Outros 5 defeitos Médios: evento movido para o passado reenvia o aviso (D-02), números por extenso ("um", "dois") não respondem às prévias (D-04, corrigido no Card 11), eventos em andamento não são encontrados (D-05), busca de evento e lembrete diferencia acento (D-06) e prévia aberta bloqueia mensagem nova curta (D-07, corrigido no Card 12).
5. Linha de base **537 testes, 0 falhas**; depois da auditoria **568 testes, 561 passam, 0 falham, 7 `todo`** (os `todo` são os defeitos reproduzidos: D-01 tem duas variantes). Cobertura medida com o recurso nativo do Node: **todos os módulos novos ≥ 90 %**; o projeto inteiro foi de 89,31 % para 90,60 %. Não existe script de lint nem de cobertura no `package.json`.

---

## 2. Linha de base (reproduzível)

Máquina: Windows 11, Node `v24.19.0`, TypeScript 5.9.3.

| Comando | Resultado |
| --- | --- |
| `npm run build` | exit 0, **17 s** |
| `npm test` (antes desta auditoria) | **537 testes, 537 passam, 0 falham** (131 s com cobertura ligada) |
| `npm test` (depois, com os testes novos) | **568 testes · 561 passam · 0 falham · 7 todo**, ~76 s, exit 0 |
| Cobertura | `node --require ./dist/test/setup.js --test --experimental-test-coverage "dist/test/**/*.test.js"` funciona no Node 24.19; "all files" linhas **89,31 % → 90,60 %** |
| Script `lint` | **não existia** na auditoria; criado no Card 18: `npm run lint` (`tsc -p tsconfig.lint.json`, `noUnusedLocals` e `noUnusedParameters`, sem dependência nova) |
| Script `coverage` | **não existia** na auditoria; criado no Card 18: `npm run coverage` (cobertura nativa do Node, sem os arquivos de teste); `npm run check` = lint + testes |
| `scratch_audit_report.html` | untracked na raiz; **não usado nem commitado**; no Card 18 entrou no `.gitignore` (`scratch_*.html`) e continua no disco |

Os 7 testes `todo` eram: D-01, D-01b, D-02, D-03, D-04, D-05, D-06. **D-02 e D-05 foram corrigidos no Card 10 e D-04 e D-06 no Card 11**; seus testes viraram testes normais e o **D-03 no Card 18** (restam 2 `todo`: D-01 e D-01b). Um `todo` que falha não derruba a suíte (exit 0) e passa a contar como falha real assim que o `todo` for removido.

Para reproduzir: `npm install && npm run build && npm test`, e o comando de cobertura da tabela.

---

## 3. Convenções

- **Status:** Atendido (código + teste que asserta o comportamento) · Atendido sem teste efetivo · Parcial · Não atendido · Não verificável.
- **Severidade:** Bloqueante (perda de dado, ação indevida sem confirmação, vazamento entre números) · Alto (fluxo principal falha ou engana) · Médio (borda, mensagem confusa, inconsistência) · Baixo (estética, duplicação).
- **Evidência:** `W:n` = `test/functional/webhook.test.ts:n`; `A:n` = `test/functional/auditoria.test.ts:n` (arquivo novo desta auditoria); `U:arquivo` = `test/unit/arquivo.test.ts`; `router.ts:n` = `src/router.ts:n` (linha do início da função).
- **"Atendido (era sem teste efetivo)"**: o critério existia no código mas nenhum teste o provava; o teste foi adicionado nesta auditoria (`A:n`).

---

## 4. Itens por card

### Card 1 — Confirmação de edição 1/2/3 (`fdde833`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C1-01 | Edição de **gasto** mostra prévia antes → depois com 1/2/3 | Atendido | `startExpenseEdits` router.ts:3542, `formatExpenseEditPreview` (confirmation/expensePreview.ts); W:3163, W:3689; U:confirmation 119 |
| C1-02 | Idem **evento** | Atendido | `buildEventPreview`; W:3204, W:3294, A:340 |
| C1-03 | Idem **lembrete** | Atendido | `buildReminderPreview`; W:3294, W:4721 |
| C1-04 | Idem **gasto fixo** | Atendido | `buildRecurringPreview`; W:3324 |
| C1-05 | `classifyConfirmationReply` só confirma/cancela com a mensagem **inteira**; "pode ser às 16h", "para sexta", "não, é às 16h" nunca confirmam | Atendido | confirmation/classify.ts:35; U:confirmation 40; W:3204 |
| C1-06 | "Corrigir" pergunta o valor por tipo: valor, data, data e hora, dia, antecedência, texto | Atendido | valor W:3261; data/hora A:599; dia A:576; antecedência A:626; texto W:3294 |
| C1-07 | Resposta inválida repete a pergunta com exemplo | Atendido | W:3238, A:576, A:599, A:626 |
| C1-08 | Valor inválido ou > 1.000.000 recusado **antes** da prévia | Atendido (era sem teste efetivo para gasto fixo) | gasto W:3843; entrada W:4429; gasto fixo A:558; U:expenseEdit (`validateAmount`) |
| C1-09 | Sem mudança real → "Já está assim, não mexi em nada." | Atendido (era sem teste efetivo para lembrete, gasto fixo e entrada) | gasto W:3874; evento W:4088; lembrete A:599; gasto fixo A:558; entrada A (último bloco) |
| C1-10 | Pendência vence em 10 min | Atendido | constants.ts; U:confirmation 161; W:4901 |
| C1-11 | Resposta fora de 1/2/3 recebe "Não entendi 🤔" com as opções | Atendido | `NOT_UNDERSTOOD_TEXT`; W:3238; A:266; ver D-07 (efeito colateral) |
| C1-12 | "cancelar" durante a prévia é tratado pelo resolvedor da edição | Atendido (D-03 corrigido no Card 18) | com espaços (" cancelar ") responde "Beleza, não mexi em nada." (era **D-03**); A:493 |

### Card 2 — Escolha do item por número (`8c33a4f`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C2-01 | Mais de um candidato gera lista numerada (até 8) com a ação original preservada | Atendido | `chooseTarget` router.ts:2826; W:3427, 3447, 3467, 3660 |
| C2-02 | Responder o número continua o fluxo sem reescrever o pedido | Atendido | W:3427, 3467; A:129 (com reinício) |
| C2-03 | Nenhum candidato → mensagem clara | Atendido (era sem teste efetivo para evento/lembrete/gasto fixo) | A (bloco "Card 2: nenhum candidato"); gasto W:2274 |
| C2-04 | Item apagado entre a lista e a resposta | Atendido | W:3576 |
| C2-05 | No máximo uma escolha pendente por número | Atendido | U:targetChoice 123; `PRIMARY KEY (from_number, kind)` db.ts |
| C2-06 | Pedido novo explícito descarta a lista | Atendido | W:3590; A:266 |
| C2-07 | Número inválido ou fora da lista recebe mensagem com a faixa válida | Atendido | W:3534; U:targetChoice 25, 83 |
| C2-08 | Lista de gastos expirada oferece os gastos recentes | Atendido | W:3554; A:243 |
| C2-09 | Busca por texto de **evento e lembrete** ignora acento/caixa como a de gastos | **Atendido (Card 11)** | `src/text/search.ts` nas seis buscas; D-06 corrigido; A:819 |

### Card 3 — Vários campos e vários gastos (`fc10094`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C3-01 | Valor, data, descrição, pagamento e categoria do mesmo gasto numa mensagem | Atendido | `buildExpenseEditItem` (expenses/editItem.ts); W:3689; U:expenseEdit |
| C3-02 | Até 5 gastos em lote, tudo validado antes da prévia | Atendido | `startExpenseEditBatch` router.ts:3610; W:3750, 3808, 3824; A:659 |
| C3-03 | Categoria/pagamento novos só criados **depois** da confirmação | Atendido | `confirmExpenseEdits` router.ts:3707; W:3689, 3735 |
| C3-04 | Se o item mudou desde a prévia, avisa em vez de sobrescrever | Atendido (só gasto/lote, que é o que o card pede) | W:3783; evento, lembrete e gasto fixo não têm: **D-08** |
| C3-05 | Mensagem com duas ações de edição não sobrescreve a primeira pendência | **Parcial** | edição+edição: W:3909, A:266, W:4474; **falha** com `delete_*` + `edit_*`: **D-01** |
| C3-06 | Opção 2 com várias mudanças pergunta "qual corrigir" | Atendido | W:3885 |

### Card 4 — Menu guiado de campos (`e33a347`, `2ed554d`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C4-01 | "editar" ou `edit_*` sem mudanças abre o menu do tipo certo, com o item no cabeçalho | Atendido | `openFieldMenu` router.ts:3083; W:3090, 4057, 4088, 4103, 4121, 4159, 4407 |
| C4-02 | Vários campos ("1 e 3"), um de cada vez, validação por resposta, opções numeradas, termina na prévia | Atendido | `resolveFieldMenuReply` router.ts:3144; W:3945, 3983, 4004; U:fieldMenu |
| C4-03 | "Cancelar" sai em qualquer etapa | Atendido | W:4037, 4004; A:310 (todos os tipos) |
| C4-04 | Pedido novo explícito descarta o menu | Atendido | W:4177 |
| C4-05 | "1 e 5" respondido na LISTA de itens pede um item por vez | Atendido | W:4225; U:targetChoice 146 |

### Card 5 — Entradas (`00105b0`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C5-01 | Listar entradas numeradas com total | Atendido | `list_incomes` router.ts:5510; W:4264, 4493 |
| C5-02 | Editar valor/descrição/data, com correção | Atendido | W:4264, 4328, 4523; A:704 |
| C5-03 | Apagar com `1 Apagar / 3 Cancelar` (2 repete) | Atendido | `resolveDeleteIncomeConfirmation` router.ts:3443; W:4295 |
| C5-04 | Escolha por número e menu guiado para entradas | Atendido | W:4328, 4350, 4382, 4407 |
| C5-05 | Desfazer de edição e exclusão restaura valor, descrição e data originais | Atendido (era sem teste efetivo: só os valores eram conferidos) | A:769 |
| C5-06 | Toda consulta filtrada pelo número do usuário | Atendido | W:4511; U:incomesEdit (`findIncomeCandidates`); leitura de incomes/service.ts |
| C5-07 | Item mudou/sumiu antes do "1" (edição e exclusão) | Atendido | W:4448 |
| C5-08 | Só a primeira ação de edição/exclusão de entrada gera pendência | Atendido | W:4474 |
| C5-09 | Sem mudança real → "Já está assim" | Atendido (era sem teste efetivo no fluxo) | A (bloco "Card 5: pedido de entrada que não muda nada") |

### Card 6 — Agenda (`64a61cd`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C6-01 | Local (definir/remover) pela frase pronta, na prévia e no desfazer | Atendido | W:4558; A:340 |
| C6-02 | Término (horário final ou duração) pela frase e pelo menu (campos 4 e 5) | Atendido | W:4589, 4676; U:agenda |
| C6-03 | Término antes do início e duração fora de 5 min–24 h rejeitados | Atendido | U:agenda; W:4589 |
| C6-04 | Sem pedido de término, a duração original é mantida | Atendido | W:4589; U:agenda (`computeProposedEnd`) |
| C6-05 | Editar só título/local/término/texto **não** reenvia aviso já enviado; início/antecedência reagendam; extras só se o início mudar | Atendido | U:agenda (todas as combinações); W:4700; **painel** A:725 (era sem teste efetivo); **desfazer** A (último bloco) |
| C6-06 | Adiar lembrete: busca de enviados (2 h / 24 h), lista numerada, aplica direto, passado rejeitado | Atendido | `snooze_reminder` router.ts:4737; W:4739, 4765, 4789, 4807; U:agenda |
| C6-07 | Desfazer do adiar devolve `due_at` e `sent` e não toca de novo | Atendido | W:4739 |
| C6-08 | A mensagem do lembrete traz a dica de adiar | Atendido (era sem teste efetivo: só `reminderText` era testado) | A:520 (cron mockado) |
| C6-09 | `edit_reminder` em lembrete já tocado explica como adiar | Atendido | W:4807 |
| C6-10 | Menu do evento com 5 campos e cabeçalho com horário e local | Atendido | W:4057, 4676; U:fieldMenu |
| C6-11 | Correção com várias mudanças (evento e lembrete) pergunta qual | Atendido | W:4642, 4721; A:340, A:626 |
| C6-12 | Evento movido para uma data passada não gera aviso fora de hora | **Atendido (Card 10)** | D-02 corrigido; A:481 |
| C6-13 | Evento em andamento pode ser editado (esticar o término) | **Atendido (Card 10)** | D-05 corrigido; A:807 |

### Card 7 — Pendências persistentes (`d0eb68d`)

| ID | Item | Status | Evidência |
| --- | --- | --- | --- |
| C7-01 | Os 10 tipos usam `pending_state`; não resta `Map` de pendência desses tipos | Atendido | `grep "new Map"` nos 10 `pending*.ts`: nenhum; db.ts; W:4838 |
| C7-02 | Sobrevivem a reinício (prova com módulos recarregados mantendo o banco) | Atendido (era sem teste efetivo: só se checava a linha no banco) | A:129 (5 reinícios no mesmo fluxo), A:170 (cada tipo), A:213 (9m59s × 10m01s) |
| C7-03 | Resposta tardia só com 1/2/3, sim/não, cancelar, número ou "desfazer" → aviso correto, sem IA | Atendido | W:4901, 4930; U:pendingStore |
| C7-04 | Pedido completo depois do prazo é processado normal; sem aviso após 60 min; um aviso por vez | Atendido | W:4961, 4994 |
| C7-05 | Versão divergente ou JSON inválido: descarta com log | Atendido | U:pendingStore |
| C7-06 | Falha do banco não derruba o fluxo | Atendido | U:pendingStore (renomeia a tabela) |
| C7-07 | Limpeza periódica remove linhas antigas | Atendido (era só `purgeOld` isolado) | U:pendingStore; A:539 (agendamento `*/10 * * * *` e limpeza na inicialização) |
| C7-08 | `cancelAllPendings`/`clearEditConfirmations`/`clearPending*` apagam a linha | Atendido | A:310; W:4838 |
| C7-09 | "Errou? Responde *desfazer*." exatamente uma vez nas mensagens de sucesso de ações com desfazer | Atendido | W:5024, A:795; U:pendingStore (`withUndoHint`) |
| C7-10 | Bloquear/revogar o número apaga as pendências dele | Atendido | W:5064 |
| C7-11 | Pendências de números diferentes não se enxergam | Atendido | W:4883; A:284 |
| C7-12 | Estado em memória que ainda existe (fora do escopo do card) | Não verificável como defeito | `listCache` (gastos/entradas) e os pendentes antigos continuam em memória; A:243 documenta o efeito |

> **Contagem final por status** (66 linhas): **Atendido: 60** (9 só porque esta auditoria acrescentou o teste: C1-08, C1-09, C2-03, C5-05, C5-09, C6-05, C6-08, C7-02, C7-07) · **Atendido sem teste efetivo: 0** nos itens (resta uma asserção sem valor em W:4880, `assert.ok(sent.length > 0)`, que não afeta nenhum critério porque o resto do teste cobre o fluxo) · **Parcial: 2** (C1-12, C3-05) · **Não atendido: 3** (C2-09, C6-12, C6-13) · **Não verificável: 1** (C7-12). Comportamento real do modelo de IA: ver seção 8.

---

## 5. Interações entre cards (RF09)

Todas executadas por teste funcional. Os testes de reinício **descartam todos os módulos de `src/` (menos `db` e `config`) e recarregam o `router`**, mantendo o mesmo banco.

| Cenário | Teste | Resultado |
| --- | --- | --- |
| (a) lista → menu → prévia → confirmar → desfazer, com **5 reinícios** no meio | A:129 | **Passa** |
| (a2) cada tipo de pendência sobrevive ao reinício | A:170 | **Passa** (edição de evento, lembrete, gasto fixo, entrada, exclusão de entrada, "editar") |
| (a3) pendência recém-criada × quase vencida, com reinício | A:213 | **Passa** (9m59s aplica, 10m01s avisa a expiração) |
| (b) pendência ativa + mensagem que dispara outro tipo | A:266 | **Passa** para pedido longo com verbo de edição (descarta com aviso) e edição+edição (adia). **Falha** (D-01) para `delete_*` + `edit_*`. Mensagem nova **curta** durante a prévia não é processada (D-07). |
| (c) dois números ao mesmo tempo | A:284 | **Passa**, sem vazamento |
| (d) "cancelar" com pendência persistida | A:310 | **Passa** em 5 tipos; variante com espaços passa desde o Card 18 (D-03) |
| (e) evento com vários campos + correção + local/término + desfazer | A:340 | **Passa** |
| (f) lista de gastos antiga após reinício | A:243 | **Passa** como limitação documentada: "edita o 2" cai em "lista expirada" e oferece os recentes |
| (g) duas edições seguidas, desfazer | A:387 | **Passa**: só a última volta; um 2º "desfaz" responde "Não tem nada recente" |
| (h) áudio transcrito, acento e emoji | A:412 | **Passa** para "Sim." (áudio), "Sím", 👍, ❌, "Não."; números por extenso falhavam (D-04, corrigido no Card 11) |

---

## 6. Defeitos

Cada defeito tem um teste `todo` em `test/functional/auditoria.test.ts` com o comportamento **esperado**: hoje falha (e não quebra a suíte); quando a correção entrar, tire o `todo` e vira teste de regressão.

### D-01 · Alto · Pedido de apagar + editar na mesma mensagem deixa duas perguntas conflitantes
- **Onde:** `processInterpretations` router.ts:992 (`EDIT_ACTION_TYPES` router.ts:968 só inclui `edit_*`, `correct_category`, `edit_income`, `delete_income`); resolvedores antigos de exclusão em `sim/não` (`resolveEventDeletionConfirmation`, `resolveDeleteExpenseConfirmation`, ...).
- **Reproduzir:** `"cancela a reunião X e renomeia a reunião X"` (IA devolve `delete_event` + `edit_event`), ou `"apaga o gasto A e muda o gasto B pra 25"`. O bot manda **duas** perguntas: `Confirma que quer cancelar? Responde "sim" ou "não".` e a prévia `1 Confirmar / 2 Corrigir / 3 Cancelar`. Responder "1" (pensando na prévia) recebe `Não entendi — quer mesmo cancelar o evento? Responde "sim" ou "não".`; responder "sim" (pensando em confirmar a edição) **cancela o evento**.
- **Esperado:** a regra RN10 do Card 3: só a primeira ação gera pendência; a segunda é adiada com `Deixei a alteração de "..." pra depois: ...`.
- **Correção sugerida (1 linha):** incluir `delete_event`, `delete_reminder`, `delete_expense` e as demais exclusões/remoções (`remove_*`, `delete_category`, `merge_categories`, `bulk_recategorize`) em `EDIT_ACTION_TYPES` e em `pendingEditBlockerLabel`.
- **Evidência:** A:450, A:465 (`todo`).

### D-02 · Médio · Mover um evento para o passado reenvia o aviso — ✅ CORRIGIDO no Card 10
- **Correção (Card 10):** `getDueEventReminders`/`getDueExtraEventReminders` ganharam o limite superior (agora ≤ início + 5 min, constante `EVENT_REMINDER_GRACE_MINUTES`); a prévia de remarcação para o passado mostra `⚠️ Esse horário já passou — não vou mandar aviso.`; o aviso ignorado vira `event_reminder_skipped` no log (uma vez por evento). O teste A:481 deixou de ser `todo`.
- **Onde:** `getDueEventReminders` events/service.ts:154 (sem limite superior) + `updateEvent` (início mudou → `reminder_sent = 0`); `edit_event` não valida data passada.
- **Reproduzir:** evento daqui a 3 dias já avisado; `"muda o evento pra anteontem"` → "1". `getDueEventReminders()` passa a incluir o evento e o "Daqui a 1 hora" dispara no minuto seguinte para algo que já passou. (O mesmo vale para os extras.)
- **Esperado:** aviso só para evento que ainda não começou, ou aviso ao usuário ao remarcar para o passado.
- **Correção sugerida:** exigir `datetime('now') < datetime(start)` em `getDueEventReminders`/`getDueExtraEventReminders` (sugestão já registrada no Card 6, seção 14).
- **Evidência:** A:481 (`todo`).

### D-03 · Baixo · `" cancelar "` com espaço cai no cancelamento geral — **corrigido no Card 18**
- **Onde:** router.ts:677, `/^s*cancel(a|ar)s*[.!]*s*$/i` — as barras invertidas se perderam: `s*` (letra "s" repetida) no lugar de `\s*`. Também casa "cancelass".
- **Reproduzir:** durante uma prévia, enviar `" cancelar "` (com espaço antes/depois, comum em colagem/áudio): resposta `Beleza, cancelei o que estava pendente — nada disso foi registrado...` em vez de `Beleza, não mexi em nada.`. O efeito prático é só o texto (a pendência é cancelada nos dois caminhos).
- **Correção (Card 18):** nova constante `CANCEL_ONLY_REPLY` (com `\s`) ao lado de `CANCEL_COMMAND`; varredura de todos os regex de `src/` e `scripts/` (161) sem outro caso; o teste virou normal (A:493) e ganhou variantes (`Cancelar.`, `cancela!`, espaços, tab) e negativos (`cancelass`, `scancelar`). Antes (sugestão original): restaurar `\s` no regex.
- **Evidência:** A:493 (teste normal desde o Card 18).

### D-04 · Médio · Números por extenso não respondem à prévia 1/2/3 — ✅ CORRIGIDO no Card 11
- **Correção (Card 11):** `normalizeReply` foi para `confirmation/normalize.ts` e `NUMBER_WORDS`/`parseChoiceNumber`/`looksLikeMultipleNumbers` para `confirmation/numbers.ts` (tabela única de um a dez, usada também pelo menu de campos); `classifyConfirmationReply` lê o número por `parseChoiceNumber` ("Um.", "opção um", "três" valem; "um pouco" continua texto livre). As etapas "qual corrigir" e a escolha de opção do menu de edição passaram a usar a mesma leitura. O teste A:505 deixou de ser `todo`.
- **Onde:** `classifyConfirmationReply` (confirmation/classify.ts:35) só conhece "1", "2", "3"; a lista de escolha (`parseChoiceNumber`) e o menu de campos já aceitam "um", "dois"...
- **Reproduzir:** com uma prévia aberta, responder por áudio "Um." (transcrição típica de "1") → `Não entendi 🤔 Responde *1*...`. O aviso de expiração (`replyShape`) já trata "um" como resposta, o que deixa as telas inconsistentes.
- **Correção sugerida:** reaproveitar `NUMBER_WORDS` de `targetChoice/reply.ts` no classificador (um/uma → 1, dois → 2, três → 3).
- **Evidência:** A:505 (`todo`).

### D-05 · Médio · Evento em andamento não é encontrado — ✅ CORRIGIDO no Card 10
- **Correção (Card 10):** novas `findEditableEvents`/`listEditableEvents` (término ≥ agora − 2 h) são usadas por editar, cancelar e pelo menu "editar > Evento"; as listas e prévias mostram `· em andamento`. `findUpcomingEvents`/`listUpcomingEvents` seguem só com futuros (avisos extras, painel, relatório). O teste A:807 deixou de ser `todo`.
- **Onde:** `findUpcomingEvents` events/service.ts (`datetime(start) >= datetime('now')`) e `listUpcomingEvents`.
- **Reproduzir:** reunião começou há 30 min; `"a reunião vai durar 3 horas"` → `Não encontrei nenhum evento futuro parecido...`. Esticar o término depois que o evento começou é o caso de uso mais comum do campo "Término" (Card 6).
- **Correção sugerida:** buscar eventos com `end >= now` (ou `start >= now - 24h`) nos fluxos de edição, mantendo só futuros para cancelar/remarcar se preferirem.
- **Evidência:** A:807 (`todo`).

### D-06 · Médio · Busca de evento e lembrete diferencia acento e caixa — ✅ CORRIGIDO no Card 11
- **Correção (Card 11):** novo `src/text/search.ts` (`normalizeSearch`, `matchesQuery`, `filterByQuery`): sem acento, sem caixa, todas as palavras em qualquer ordem, artigos ignorados, `%` e `_` sem função de curinga. As seis buscas (`findUpcomingEvents`, `findEditableEvents`, `findPendingRemindersByText`, `findRecentSentReminders`, `findActiveBillAlertByName`, `findActiveRecurringExpenseByDescription`) trazem até 500 linhas já filtradas por número/janela e filtram o texto em código; o limite de 10 vale depois do filtro. O teste A:819 deixou de ser `todo`.
- **Onde:** `findUpcomingEvents` (`title LIKE ?`) e `findPendingRemindersByText` (`message LIKE ?`); `LIKE` do SQLite só ignora maiúsculas ASCII. Gastos, entradas e gastos fixos usam normalização sem acento.
- **Reproduzir:** lembrete "Remédio da pressão", pedido `"muda o lembrete do remedio..."` (sem acento, como a maioria digita) → `Não encontrei nenhum lembrete parecido com "remedio"` (a IA nem sempre devolve o acento). Idem "Consulta médica" × "medica". Os caracteres `%` e `_` na busca também não são escapados.
- **Correção sugerida:** filtrar em JS com a mesma `normalize` de `incomes/service.ts` (janela de 20-50 itens), como já é feito para gastos.
- **Evidência:** A:819 (`todo`).

### D-07 · Médio · Prévia aberta bloqueia mensagem nova curta — ✅ CORRIGIDO no Card 12
- **Correção (Card 12):** `handleNotUnderstood` (router) roda só depois que o resolvedor da confirmação desistiu: "desfaz isso" cancela a confirmação sem desfazer a última ação (RN07); um pedido novo claro e seguro (`src/pending/newRequest.ts`, lista fechada de registrar/criar/consultar, mínimo de 2 palavras) troca a confirmação e é atendido por `dispatchInterpretations`; o resto recebe o "não entendi" com a dica `PENDING_EXIT_HINT`. Uma chamada de IA no máximo, só depois da decisão do resolvedor. Cobre as prévias de edição (gasto, entrada, evento, lembrete, gasto fixo), as 10 perguntas de apagar/remover (inclui apagar entrada) e a etapa de escolha de campos do menu. Ajustes da revisão: registrar/criar exige 3 palavras ou mais (consulta, 2); no máximo 3 segundas chances (chamadas de IA) por número a cada 10 min; no menu de campos a dica é "responde *cancelar*" (o 3 é um campo); o rótulo e o texto ("alteração" × "pergunta sobre") vêm do resolvedor que respondeu; uma única linha de log por resposta não entendida. `looksLikeExplicitDifferentRequest` e as etapas de valor/correção/lista de alvo não mudaram.
- **Onde:** `looksLikeExplicitDifferentRequest` router.ts:1256 exige ≥ 5 palavras **e** verbo de edição; o resolvedor da prévia responde `Não entendi 🤔 Responde *1* pra confirmar, *2* pra corrigir ou *3* pra cancelar.` a qualquer outra coisa.
- **Reproduzir:** com uma prévia aberta, mandar `"gastei 30 no mercado"` ou `"desfaz isso"` (para desfazer a edição anterior) → só a mensagem de "não entendi", o gasto **não** é registrado (e a interpretação não é consumida). O usuário só sai respondendo 1/2/3/"cancelar" ou esperando 10 min. A mensagem de ajuda não menciona "cancelar" como saída.
- **Correção sugerida:** incluir a saída na mensagem (`...ou *cancelar* pra mandar outra coisa`) e/ou tratar gasto completo claro (valor + descrição) como pedido novo.
- **Evidência:** execução manual de cenário (E2 do plano de auditoria): sem teste `todo` porque o comportamento esperado é decisão de produto.

### D-08 · Baixo · "Item mudou desde a prévia" só existe para gasto e entrada
- Evento, lembrete e gasto fixo aplicam a prévia sem conferir se o registro foi alterado (por exemplo no painel) entre a prévia e o "1".
- **Correção sugerida:** o mesmo snapshot de `previous` comparado antes de aplicar, como em `confirmExpenseEdits`/`confirmIncomeEdit`. (Sugestão já registrada no Card 4, seção 14.)

### D-09 · Baixo · Textos e formatos inconsistentes entre fluxos novos e antigos
> **Corrigido em parte pelo Card 9:** as confirmações de apagar/remover dos 9 fluxos (evento, lembrete, gasto e compra parcelada, categoria, orçamento, gasto fixo, alerta de conta, juntar categorias e recategorizar em lote) passaram para o padrão `1`/`3`, valor `R$ 10,00` e data `qui 15/10 às 10:00`, 10 minutos e persistentes. **Continua aberto:** o formato antigo `R$10.00` / `15/10/2026, 10:00:00` em mensagens de sucesso de outros fluxos (por exemplo "evento criado", "alterado: de ... pra ...") e a frase única "Já está assim, não mexi em nada.".

- Dinheiro: `R$ 10,00` (novo) × `R$10.00` (exclusões e criações antigas).
- Datas: `qui 15/10 às 10:00` (novo) × `15/10/2026, 10:00:00` (mensagem de sucesso de evento/lembrete e confirmação de cancelamento).
- ~~Confirmação de exclusão de evento, lembrete, gasto, categoria, orçamento e gasto fixo continua em `sim/não`~~ — **corrigido no Card 9** (agora todas usam `1`/`3`).
- "Já está assim, não mexi em nada." (o Card 4 pedia "não mudei nada" para evento/lembrete/gasto fixo; foi adotada uma frase só).

### D-10 · Baixo · Ajuda e boas-vindas defasadas
- `WELCOME_MESSAGE` (router.ts:555) não cita editar pelo menu, entradas, adiar lembrete nem "desfazer". `helpTopicMessage` está atualizado para gasto, evento, lembrete e entrada.

### D-11 · Baixo · Tamanho e duplicação do `router.ts`
- 5.814 linhas, 128 funções de topo; `handleInterpretation` passa de 1.300 linhas. Cinco resolvedores de confirmação quase iguais (`resolveEditExpense/Event/Reminder/Recurring/IncomeConfirmation`, ~1.000 linhas) e dez wrappers `pending*.ts` repetem o mesmo padrão. Lacuna de cobertura: o `router.js` ficou em 89,18 %.

### D-12 · Baixo · Retenção de dados no log de atividade
- `logActivity` grava descrições, valores e títulos em texto (por exemplo `pediu confirmacao: #5 Mercado: Valor R$ 38,00 -> R$ 45,00`) sem prazo de retenção. `pending_state` guarda no máximo 70 min, mas o `activity_log` não tem limpeza.

### D-13 · Baixo · Higiene do repositório e ferramentas — **corrigido no Card 18**
- **Corrigido no Card 18:** `npm run lint` (código morto; os 26 avisos foram zerados), `npm run coverage`, `npm run check`, `tsconfig.lint.json` e `scratch_*.html` no `.gitignore`. O `tsconfig.json` principal (e o build do Docker) não mudou.
- Não há `lint` nem `coverage` no `package.json`; o `tsconfig` não usa `noUnusedLocals` (imports mortos não são detectados). Arquivo solto `scratch_audit_report.html` na raiz.

---

## 7. Lacunas de teste encontradas e o que foi feito

| Lacuna | Situação |
| --- | --- |
| Sobrevivência a reinício só checava a linha no banco (não recarregava módulos) | **Corrigida**: A:129, A:170, A:213 |
| Dica de adiar no toque só testada em `reminderText`, não no agendador | **Corrigida**: A:520 |
| RN10 pelo painel e pelo desfazer sem teste | **Corrigida**: A:725 e último bloco do arquivo |
| Desfazer de entrada só conferia o valor | **Corrigida**: A:769 |
| Limpeza periódica só testada como função | **Corrigida**: A:539 |
| Validação de gasto fixo, "Já está assim" de lembrete/fixo/entrada, correção por dia/antecedência/local, erros do lote | **Corrigidas**: A:558, 576, 599, 626, 659, 704, último bloco |
| Mensagem de "nenhum candidato" para evento, lembrete e gasto fixo | **Corrigida**: bloco "Card 2: nenhum candidato" |
| Asserção sem valor (`assert.ok(sent.length > 0)`) | **Pendente** em W:4880 (não alterei testes existentes) |
| Resposta real do modelo para `changes`, `snooze_reminder`, `list_incomes`... | **Não verificável** sem chamar a API (ver seção 8) |
| `reminders/scheduler.js` e `ai/interpret.js` com cobertura baixa | `scheduler.js` 93,6 % agora; `interpret.js` 76 % (parte do código só roda com a API real) |

---

## 8. Não verificável

- **Qualidade da classificação pela IA:** todos os testes funcionais devolvem exatamente a interpretação que o código espera (RN "teste que passa por motivo errado"). O prompt e o schema novos (`changes[]`, `edit_income`, `delete_income`, `list_incomes`, `snooze_reminder`, `new_location`...) só têm teste de montagem do prompt (`U:interpretContext`). Quem decide se "adia 30 min" vira `snooze_reminder` e se "edita o 2" com lista de entradas vira `edit_income` é o modelo; isso exige uma amostra real de mensagens (o roteiro manual cobre).
- **Concorrência real de webhooks do mesmo número:** não há trava; a última escrita vence (aceito no Card 7). Um teste de duas mensagens "1" simultâneas aplicou uma vez só, mas não prova ausência de condição de corrida em outras sequências.
- **Horário de verão:** não se aplica a São Paulo; virada de dia/mês foi coberta por testes unitários com "hoje" injetado.

---

## 9. Cobertura dos módulos novos

Comando: `node --require ./dist/test/setup.js --test --experimental-test-coverage "dist/test/**/*.test.js"` (568 testes). Onde há "era X %", X é o valor da linha de base.

| Módulo | Linhas % | Ramos % | Observação |
| --- | --- | --- | --- |
| `confirmation/classify.js` | 100 | 100 | |
| `confirmation/constants.js` | 100 | 100 | |
| `confirmation/expensePreview.js` | 100 | 100 | |
| `confirmation/incomePreview.js` | 100 | 100 | |
| `confirmation/parsers.js` | 100 | 99,1 | |
| `confirmation/preview.js` | 100 | 96,6 | |
| `targetChoice/format.js` | 100 | 91,7 | |
| `targetChoice/pending.js` | 100 | 100 | |
| `targetChoice/reply.js` | 100 | 100 | |
| `fieldMenu/format.js` | 100 | 100 | |
| `fieldMenu/pending.js` | 100 | 100 | |
| `fieldMenu/registry.js` | 100 | 100 | |
| `fieldMenu/select.js` | 100 | 100 | |
| `fieldMenu/validate.js` | 96,6 | 88,0 | linhas 69-73: ramo `catch` da IA de data/hora |
| `pending/store.js` | 100 | 100 | |
| `pending/expiredNotice.js` | 100 | 100 | |
| `pending/cleanup.js` | 94,1 | 75,0 | linha 15 (callback do cron) |
| `undo/pendingUndo.js` | 100 | 100 | |
| `undo/replyWithUndo.js` | 100 | 100 | |
| `pendingEditTarget.js` | 100 | 100 | |
| `events/editPlan.js` | 100 | 100 | |
| `events/pendingEditEvent.js` | 100 | 100 | |
| `reminders/snooze.js` | 100 | 100 | |
| `reminders/pendingEditReminder.js` | 100 | 100 | |
| `reminders/scheduler.js` | 93,6 | 62,5 | era 51,6 % antes da auditoria; linhas 27-28 (erro no envio) |
| `expenses/editChanges.js` | 100 | 100 | |
| `expenses/editItem.js` | 92,0 | 85,7 | linhas 34-41, 89-93 (fallback da IA de data, forma de pagamento nova) |
| `expenses/parseDate.js` | 100 | 100 | |
| `expenses/pendingEditExpense.js` | 100 | 100 | |
| `expenses/pendingEditRecurring.js` | 100 | 100 | |
| `expenses/listCache.js` | 91,4 | 72,7 | linhas 28-30 (`clearLastShownExpenses` em fluxo sem lista) |
| `incomes/editItem.js`, `listCache.js`, `pendingDeleteIncome.js`, `pendingEditIncome.js` | 100 | 100 | |
| `incomes/service.js` | 100 | 95,8 | |
| **Nenhum módulo novo abaixo de 90 %** | | | |
| `router.js` (não é módulo novo) | 89,32 | 87,68 | era 86,19 % antes da auditoria; sobram ramos de erro dos resolvedores de gasto fixo, lembrete, entrada e lote, e as ajudas |
| Projeto inteiro | **90,60** | 88,64 | era 89,31 / 85,74 |

---

## 10. Qualidade e segurança (RF11)

| Verificação | Resultado |
| --- | --- |
| Consultas sem filtro por número | Nenhuma nos arquivos novos: `pending_state`, `incomes/service`, `reminders/service` (`findRecentSentReminders`, `rescheduleReminder`) e `events/service.updateEvent` (confere o dono antes) filtram por número. Exceções intencionais: `purgeOld` (manutenção global) e `getIncomeSummaryBetween` sem número (uso do admin). |
| `JSON.parse` sem tratamento | Um só lugar novo, `pending/store.ts:108`, dentro de `try/catch` com descarte e log. |
| Logs com dados sensíveis | `store.ts` loga só tipo e motivo; o `activity_log` guarda descrições e valores sem retenção (D-12). |
| Textos inconsistentes | D-09. |
| Código duplicado | D-11. |
| Tamanho do `router.ts` | D-11 (5.814 linhas). |
| `catch` vazios | Só `dashboard/layout.ts:442,447` (script do navegador, fora do escopo). |
| Promessas sem `await` | Nenhuma `sendText` sem `await`/`return` encontrada; os `.catch(...)` explícitos do alerta ao dono em `handleIncomingMessage` são intencionais. |
| Ajuda e README | README atualizado a cada card; boas-vindas defasada (D-10). |
| Lint e cobertura | **Criados no Card 18:** `npm run lint`, `npm run coverage` e `npm run check` (ver README). |
| Volume persistente do SQLite | O README já documenta `/app/data` no Coolify e o `.env.example` aponta `DB_PATH=./data/data.sqlite`; o `Dockerfile` não define volume (é configurado no Coolify). Sem o volume, o `pending_state` (e tudo mais) some no deploy. **Confirmar no Coolify** que o volume está montado. |

---

## 11. Ordem recomendada dos cards de correção

1. **D-01** (Alto): bloquear `delete_*` e `remove_*` junto de `edit_*` na mesma mensagem. É a única que pode apagar algo que o usuário acha que está só editando.
2. ~~**D-02** + **D-05** (Médio, ambos de agenda)~~ — feito no Card 10.
3. ~~**D-06** + **D-04** (Médio)~~ — feito no Card 11.
4. ~~**D-07** (Médio)~~ — feito no Card 12.
5. ~~**D-03** (Baixo, uma linha) junto de **D-13** (script de cobertura/lint e `noUnusedLocals`)~~ — feito no Card 18.
6. **D-08**, **D-09**, **D-10** (consistência de produto), **D-12** (retenção do log) e **D-11** (refatoração do `router.ts`, fazer por último e com os testes desta auditoria como rede de segurança).

---

## 12. Arquivos criados e contagem

- Criados: `docs/auditoria-cards-1-a-7.md`, `docs/roteiro-manual-whatsapp.md`, `test/functional/auditoria.test.ts` (31 testes: 24 comprovam critérios, 7 `todo` reproduzem defeitos).
- Nenhum arquivo de `src/` alterado.
- Itens do checklist: 66 · defeitos: 13 (1 Alto, 5 Médios, 7 Baixos); 0 Bloqueantes.
