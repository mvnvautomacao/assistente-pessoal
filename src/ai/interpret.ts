import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { listCategories, listPaymentMethods } from "../expenses/service";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export type Interpretation =
  | { type: "expense"; amount: number; category: string; description: string; date: string; payment_method?: string }
  | {
      type: "installment_expense";
      description?: string;
      category?: string;
      date?: string;
      total_amount?: number;
      installment_amount?: number;
      installments?: number;
      payment_method?: string;
    }
  | { type: "event"; title: string; start: string; end?: string; location?: string }
  | { type: "delete_event"; query: string }
  | { type: "edit_event"; query: string; new_date?: string; new_time?: string }
  | { type: "reminder"; message: string; due_at: string }
  | { type: "edit_reminder"; query: string; new_date?: string; new_time?: string }
  | { type: "report"; days?: number; month?: string }
  | { type: "expense_report"; period?: "week" | "month"; days?: number; category?: string }
  | { type: "correct_category"; category: string; query?: string }
  | { type: "set_default_payment"; payment_method: string }
  | { type: "set_report_day"; day_of_week: string }
  | { type: "set_budget"; category: string; amount: number }
  | { type: "remove_budget"; category: string }
  | { type: "list_budgets"; category?: string }
  | { type: "list_categories" }
  | { type: "create_category"; category: string }
  | { type: "merge_categories"; category: string; to_category: string }
  | {
      type: "bulk_recategorize";
      to_category: string;
      scope: "today" | "last_n" | "from_category" | "period" | "keyword";
      n?: number;
      category?: string;
      days?: number;
      period?: "week" | "month";
      date_start?: string;
      date_end?: string;
      query?: string;
    }
  | { type: "undo" }
  | { type: "set_recurring_expense"; description: string; amount: number; category: string; day_of_month: number; payment_method?: string }
  | { type: "list_recurring_expenses" }
  | { type: "remove_recurring_expense"; query: string }
  | { type: "income"; amount: number; description: string; date: string }
  | { type: "income_report"; period?: "week" | "month"; days?: number }
  | { type: "balance"; period?: "week" | "month"; days?: number }
  | {
      type: "help";
      topic?:
        | "expense"
        | "event"
        | "reminder"
        | "budget"
        | "expense_report"
        | "edit_expense"
        | "category"
        | "payment_method"
        | "welcome"
        | "recurring_expense"
        | "income";
    }
  | { type: "list_expenses"; date?: string; days?: number }
  | {
      type: "edit_expense";
      list_ref?: number;
      query?: string;
      field: "amount" | "date" | "description" | "payment_method";
      value: string;
    }
  | {
      type: "unknown";
      description?: string;
      likely_intent?: "expense" | "event" | "reminder";
      title?: string;
      message?: string;
      date?: string;
      time?: string;
      amount?: number;
      category?: string;
    };

const ACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: [
        "expense",
        "installment_expense",
        "event",
        "reminder",
        "delete_event",
        "edit_event",
        "edit_reminder",
        "report",
        "expense_report",
        "correct_category",
        "set_default_payment",
        "set_report_day",
        "set_budget",
        "remove_budget",
        "list_budgets",
        "list_categories",
        "create_category",
        "merge_categories",
        "bulk_recategorize",
        "list_expenses",
        "edit_expense",
        "undo",
        "set_recurring_expense",
        "list_recurring_expenses",
        "remove_recurring_expense",
        "income",
        "income_report",
        "balance",
        "help",
        "unknown",
      ],
      description:
        "expense = o usuario relatou um gasto/compra JA ACONTECIDO E A VISTA (nao parcelada -- se mencionar parcelamento, use installment_expense), com valor E com uma descricao minima do que foi (ex: '50 no mercado', 'gastei 30 reais de uber'). Se faltar um dos dois -- so o valor sem dizer do que foi (ex: 'gastei 50 reais'), ou so a descricao sem o valor (ex: 'comprei remedio na farmacia', sem dizer quanto) -- NAO INVENTE o que falta: classifique como 'unknown' com likely_intent='expense', preenchendo 'amount' SE o valor ficou claro e 'description' SE a descricao ficou clara, pra pedir so o que realmente falta. installment_expense = quer registrar uma COMPRA PARCELADA/DIVIDIDA, nao uma compra a vista (ex: 'comprei uma tv de 1500 em 3x', 'dividi a compra do mercado em 3 vezes', 'parcelei em 2x', '200 no cartao em 2x', 'gastei 90 parcelado'). QUALQUER mencao a 'parcelado'/'parcelei'/'dividido'/'dividi'/'Nx'/'N vezes' indica esse tipo em vez de 'expense', MESMO que falte informacao -- nunca vira 'unknown' nem 'expense' simples. Preencha 'description' e 'category' se ficaram claros (podem ficar vazios). Preencha 'total_amount' SE o usuario disse o valor TOTAL da compra, OU 'installment_amount' SE disse o valor de CADA parcela -- nunca os dois ao mesmo tempo; se nao disse valor nenhum, deixe os dois vazios. Preencha 'installments' com a quantidade de parcelas SE foi mencionada (ex: '3x', 'em 3 vezes' -> 3); se so disse 'parcelado'/'dividido' sem dizer quantas vezes, deixe 'installments' vazio -- o sistema pergunta a quantidade que falta, junto com qualquer outro dado que tambem esteja faltando. Preencha 'date' com o dia da compra/1a parcela SE mencionado (sem mencao, o sistema assume hoje sozinho -- pode deixar vazio). event = quer marcar algo na agenda, E a mensagem MENCIONA TANTO o dia QUANTO o horario (ex: 'dentista amanha 15h', 'reuniao sexta as 10h'). Se faltar UM dos dois -- so o dia sem horario (ex: 'quarta-feira agendar revisao do carro'), so o horario sem dia, ou nenhum dos dois (ex: 'adicionar consulta medica', 'marca dentista') -- NAO INVENTE o que falta: classifique como 'unknown' com likely_intent='event', preenchendo 'title' com o titulo/assunto SE ficou claro (ex: 'revisao do carro'), 'date' (YYYY-MM-DD) SE o dia ficou claro, e 'time' (HH:MM) SE o horario ficou claro -- pra pedir so o que falta, sem o usuario precisar repetir o que ja disse. reminder = quer ser lembrado de algo depois, E a mensagem menciona TANTO o dia/momento QUANTO o horario de aviso; mesma regra do event acima -- se faltar o dia, o horario, ou os dois, classifique como 'unknown' com likely_intent='reminder', preenchendo 'message' com o texto do lembrete SE ficou claro, 'date' SE o dia ficou claro e 'time' SE o horario ficou claro. delete_event = quer cancelar/remover/desmarcar um compromisso que ja existe na agenda. edit_event = quer MUDAR A DATA e/ou A HORA de um evento que ja existe na agenda, sem cancelar (ex: 'muda a consulta pra sexta as 16h', 'muda so o dia da consulta pro dia 20', 'muda so o horario da consulta pra 15h', 'a reuniao de amanha na verdade e as 15h'). Preencha 'query' com o titulo/parte do titulo do evento (busca igual delete_event). Preencha 'new_date' (YYYY-MM-DD) SE o usuario mencionou um dia novo, e 'new_time' (HH:MM) SE mencionou um horario novo -- preencha SO o que ele pediu pra mudar, NUNCA invente/repita o outro campo: se ele so falou do dia, deixe 'new_time' vazio (o sistema mantem o horario original do evento sozinho); se so falou do horario, deixe 'new_date' vazio (mantem a data original). Se mudou os dois, preencha os dois. Diferente de delete_event (cancela de vez) e de event (cria um evento novo do zero). edit_reminder = quer MUDAR A DATA e/ou A HORA de um lembrete que ja existe, sem cancelar (ex: 'muda o lembrete de pagar a internet pra amanha', 'o lembrete do remedio na verdade e as 21h', 'muda so o dia do lembrete pra sexta'). Preencha 'query' com uma palavra-chave da mensagem do lembrete. Preencha 'new_date' (YYYY-MM-DD) SE mencionou um dia novo e 'new_time' (HH:MM) SE mencionou um horario novo -- mesma regra do edit_event: preencha SO o que foi pedido, deixando o outro campo vazio pra manter o valor original do lembrete. report = quer um resumo/relatorio do que tem agendado (eventos e/ou lembretes). Duas formas: 'proximos X dias' a partir de agora (ex: 'o que tenho agendado', 'proximos 15 dias') -- preencha 'days' (padrao 7 se nao especificar); ou um MES especifico, nomeado (ex: 'exibir minha agenda de novembro', 'o que tenho marcado em dezembro', 'agenda de janeiro que vem') -- preencha 'month' com 'YYYY-MM' (resolva o ano: se o mes nomeado ja passou esse ano, use o ano que vem; senao, esse ano mesmo) e NAO preencha 'days' nesse caso. expense_report = quer saber quanto gastou/resumo de gastos num periodo (total/por categoria), opcionalmente numa categoria especifica (ex: 'quanto gastei essa semana', 'ultimos 15 dias quanto gastei em veiculo'). correct_category = quer mudar so a CATEGORIA de um gasto que ja foi registrado (ex: 'muda a categoria do mercado pra lazer', 'aquilo era carro, nao mercado'). set_default_payment = quer definir a forma de pagamento padrao pros proximos gastos (ex: 'meu pagamento padrao e pix', 'sempre uso o cartao nubank'). set_report_day = quer escolher/mudar em qual dia da semana recebe o relatorio semanal automatico de gastos (ex: 'quero receber o relatorio toda sexta'). set_budget = quer definir/mudar um orcamento mensal maximo pra uma categoria, pra ser avisado se passar (ex: 'me avisa se eu passar de 500 reais em lazer', 'define um orcamento de 300 pra mercado'). remove_budget = quer remover o orcamento de uma categoria (ex: 'tira o limite de lazer'). list_budgets = quer ver o(s) orcamento(s) definidos e quanto ja gastou — se o usuario mencionar uma categoria especifica (ex: 'qual o limite de mercado', 'quanto ainda posso gastar em lazer'), preencha 'category' com ela; se pedir todos (ex: 'quais orcamentos eu tenho'), deixe 'category' em branco. list_categories = quer ver quais categorias de gasto existem (ex: 'quais categorias eu tenho', 'lista as categorias'). create_category = quer CRIAR uma categoria nova, sem estar associada a nenhum gasto especifico ainda (ex: 'criar categoria Marina nos meus gastos', 'cria uma categoria chamada Pets', 'adiciona a categoria Viagem'). Repare que o pedido e sobre a CATEGORIA em si (o substantivo 'categoria' aparece na frase, mesmo com erro de digitacao tipo 'caregoria'), nao um gasto de verdade -- nao confundir com type=expense (que e um gasto JA ACONTECIDO com valor). Preencha 'category' com o nome exato pedido. merge_categories = quer JUNTAR/FUNDIR duas categorias que ja existem numa so, apagando a categoria de origem depois de mover os gastos dela (ex: 'junta a categoria Mercado com Supermercado', 'funde Lazer e Diversao numa so'). Preencha 'category' com a categoria de ORIGEM (que vai deixar de existir) e 'to_category' com a categoria final que sobra. Diferente de bulk_recategorize scope='from_category', que so move os gastos mas MANTEM a categoria de origem (vazia); merge_categories tambem apaga ela. bulk_recategorize = quer mudar a categoria de VARIOS gastos de uma vez (nao um so -- pra um so, use correct_category). Preencha 'to_category' com a categoria final desejada, e 'scope' com uma destas formas de escolher quais gastos mudam: 'today' = todos os gastos de hoje (ex: 'muda os gastos de hoje pra lazer'); 'last_n' = os N gastos mais recentes, preencha tambem 'n' com a quantidade (ex: 'muda os ultimos 5 gastos pra mercado', n=5); 'from_category' = TODOS os gastos que estao numa categoria especifica (categoria de origem continua existindo, so fica vazia), preencha tambem 'category' com o nome dela (ex: 'muda os gastos de mercado pra lazer' -> category='mercado', to_category='lazer'); 'period' = gastos de um periodo especifico, preencha 'days' (ultimos X dias), 'period' ('week'/'month') ou 'date_start'+'date_end' (intervalo exato de datas ISO, ex: 'gastos de 10 a 20 desse mes' -> date_start/date_end desse mes); 'keyword' = todos os gastos cuja DESCRICAO bate com um texto, preencha 'query' com a palavra-chave (ex: 'muda todo gasto com ifood na descricao pra alimentacao' -> query='ifood'). list_expenses = quer ver os GASTOS INDIVIDUAIS (nao o resumo por categoria) de um dia ou periodo, normalmente pra depois editar um deles (ex: 'quais gastos eu tive hoje', 'lista as compras de ontem', 'editar gastos do dia 20', 'me mostra os gastos dos ultimos 3 dias'). Isso inclui pedidos VAGOS sem nenhum dia mencionado, tipo so 'editar compras', 'editar gastos' ou 'quero editar uma compra' — NAO classifique esses como unknown, classifique como list_expenses mesmo sem 'date'/'days' (o sistema avisa o usuario que vai assumir hoje e pede pra especificar se quiser outro dia). Preencha 'date' (ISO 8601, so a data) se um dia especifico foi mencionado, ou 'days' pra 'ultimos X dias'; sem nenhum dos dois, assume hoje. help = quer saber o que o assistente faz, como usar, ou tem uma DUVIDA especifica sobre como fazer algo (ex: 'o que voce faz', 'como funciona', 'como adiciono um gasto', 'como marco um compromisso', 'como faço pra editar um gasto que ja registrei'). Se a duvida for sobre um assunto especifico que o sistema faz, preencha 'topic' com ele (expense/event/reminder/budget/expense_report/edit_expense/category/payment_method) pra explicar so aquilo, com exemplo — nao o catalogo inteiro. Se o usuario pedir EXPLICITAMENTE pra ver/reenviar a mensagem de boas-vindas (ex: 'manda a mensagem de boas-vindas', 'reenvia as boas-vindas'), preencha topic='welcome'. Se for uma pergunta bem generica tipo 'o que voce faz' ou 'me ajuda', sem tema especifico, deixe 'topic' em branco. edit_expense = quer ALTERAR um gasto ja registrado (valor, data, descricao ou forma de pagamento — pra mudar categoria use correct_category). Se ele se referir a um item por numero de uma lista mostrada antes (ex: 'edita o 2', 'muda o 3 pro valor 45'), preencha 'list_ref' com esse numero e NAO preencha 'query'. Se ele descrever o gasto por texto (ex: 'a farmacia foi no pix', 'o gasto do mercado era 45 no total'), preencha 'query' com esse texto e NAO preencha 'list_ref'. Sempre preencha 'field' (amount/date/description/payment_method) e 'value' com o novo valor. undo = quer desfazer/cancelar a ULTIMA acao que ele mesmo pediu ao assistente (ex: 'desfaz isso', 'desfaz a ultima acao', 'cancela isso que eu mandei', 'volta atras', 'tira esse gasto que acabei de colocar'). Diferente de delete_event, que e especificamente sobre cancelar um COMPROMISSO DA AGENDA por nome/busca. set_recurring_expense = quer cadastrar um GASTO FIXO/RECORRENTE, que se repete todo mes no mesmo dia, pra ser lancado automaticamente sem precisar mandar mensagem de novo (ex: 'todo dia 10 pago 50 de internet', 'cadastra um gasto fixo de 89,90 de academia todo dia 5', 'toda vez dia 15 pago 200 de aluguel'). Preencha 'description', 'amount', 'category' e 'day_of_month' (o dia do mes, numero de 1 a 31). Diferente de 'expense', que e um gasto AVULSO ja acontecido uma unica vez. list_recurring_expenses = quer ver quais gastos fixos ja tem cadastrados (ex: 'quais gastos fixos eu tenho', 'lista minhas contas fixas'). remove_recurring_expense = quer parar de lancar automaticamente um gasto fixo (ex: 'cancela o gasto fixo da academia', 'para de lançar a internet todo mes') — preencha 'query' com uma palavra-chave pra identificar qual. income = o usuario relatou uma ENTRADA de dinheiro JA ACONTECIDA (salario, freela, reembolso, venda...), nao um gasto (ex: 'recebi 3000 de salario', 'entrou 500 de freela', 'ganhei 200 de reembolso'). Preencha 'amount', 'description' e 'date' (se nao mencionar a data, use hoje). income_report = quer saber quanto recebeu/resumo de entradas num periodo (ex: 'quanto recebi esse mes', 'quanto entrou essa semana'). Preencha 'period' ('week'/'month') ou 'days', igual expense_report. balance = quer saber o SALDO (entradas menos gastos) de um periodo (ex: 'quanto sobrou esse mes', 'qual meu saldo', 'entrou mais do que gastei esse mes?'). Preencha 'period' ('week'/'month') ou 'days', igual expense_report; sem nenhum dos dois, assume o mes atual. unknown = mensagem curta/vaga que so indica a INTENCAO de fazer algo mas falta informacao pra completar (ex: so 'gasto', 'criar gasto', 'cadastrar compra', 'quero marcar um evento', 'lembrete') OU realmente nao deu pra entender nada. Isso inclui pedidos de evento/lembrete/gasto com informacao PARCIAL -- falta o dia e/ou o horario (evento/lembrete), ou falta o valor e/ou a descricao (gasto) -- NUNCA invente o que falta pra completar. Nesses casos preencha 'likely_intent' com o tipo que pareceu ser (expense/event/reminder) e preencha os campos que JA ficaram claros ('title'/'message' + 'date'/'time' pra evento/lembrete, 'amount'/'description' pra gasto), deixando os que faltam vazios -- assim o sistema pede so o que realmente falta, sem o usuario repetir o que ja disse.",
    },
    amount: {
      type: "number",
      description:
        "Valor do gasto em reais (type=expense ou type=set_recurring_expense), o valor do orcamento mensal em reais (type=set_budget), ou o valor JA CONHECIDO de um gasto parcial (type=unknown com likely_intent='expense', se o usuario ja mencionou o valor mas nao a descricao).",
    },
    category: {
      type: "string",
      description:
        "Categoria do gasto (type=expense, type=installment_expense ou type=set_recurring_expense), a nova categoria desejada (type=correct_category), o nome da categoria a criar (type=create_category), o filtro de categoria (type=expense_report ou type=list_budgets, opcional), a categoria do orcamento (type=set_budget, type=remove_budget), a categoria de ORIGEM que vai ser apagada (type=merge_categories), ou a categoria de ORIGEM (type=bulk_recategorize, so quando scope='from_category' -- o destino vai em 'to_category'). Prefira uma das categorias existentes informadas no system prompt quando fizer sentido (exceto em create_category, que e justamente pra criar uma nova).",
    },
    total_amount: {
      type: "number",
      description:
        "So para type=installment_expense: o valor TOTAL da compra em reais, SE foi isso que o usuario disse (ex: 'tv de 1500 em 3x' -> 1500). Nao preencher junto com 'installment_amount'.",
    },
    installment_amount: {
      type: "number",
      description:
        "So para type=installment_expense: o valor de CADA parcela em reais, SE foi isso que o usuario disse (ex: '3x de 150' -> 150). Nao preencher junto com 'total_amount'.",
    },
    installments: {
      type: "number",
      description:
        "So para type=installment_expense: a quantidade de parcelas (numero de vezes), SE foi mencionada (ex: '3x'/'3 vezes' -> 3). Deixe vazio se o usuario so disse 'parcelado'/'dividido' sem dizer quantas vezes -- o sistema pergunta.",
    },
    to_category: {
      type: "string",
      description: "Categoria final desejada (type=bulk_recategorize ou type=merge_categories) -- pra onde os gastos selecionados devem ir / a categoria que sobra depois do merge.",
    },
    n: {
      type: "number",
      description: "Quantidade de gastos mais recentes a recategorizar (so para type=bulk_recategorize, scope='last_n').",
    },
    date_start: {
      type: "string",
      description: "Data ISO 8601 (so a data) de inicio do intervalo, so para type=bulk_recategorize com scope='period' quando o usuario deu um intervalo exato (ex: 'gastos de 10 a 20 desse mes').",
    },
    date_end: {
      type: "string",
      description: "Data ISO 8601 (so a data) de fim do intervalo (inclusive), so para type=bulk_recategorize com scope='period', usado junto com 'date_start'.",
    },
    scope: {
      type: "string",
      enum: ["today", "last_n", "from_category", "period", "keyword"],
      description:
        "So para type=bulk_recategorize: qual conjunto de gastos muda de categoria. 'today' = os de hoje. 'last_n' = os N mais recentes (preencha 'n'). 'from_category' = todos os que estao numa categoria (preencha 'category'). 'period' = os de um periodo (preencha 'days', 'period', ou 'date_start'+'date_end'). 'keyword' = os que tem uma palavra na descricao (preencha 'query').",
    },
    payment_method: {
      type: "string",
      description:
        "Forma de pagamento mencionada (type=expense, type=installment_expense ou type=set_recurring_expense, so se o usuario mencionou explicitamente) ou a forma de pagamento a definir como padrao (type=set_default_payment). Prefira uma das formas de pagamento existentes informadas no system prompt quando fizer sentido, ex: Pix, Dinheiro, ou o nome de um cartao especifico.",
    },
    description: {
      type: "string",
      description:
        "Descricao curta do gasto (type=expense, type=installment_expense, type=set_recurring_expense), a descricao JA CONHECIDA de um gasto parcial (type=unknown com likely_intent='expense', se o usuario ja descreveu do que foi mas nao o valor), ou o motivo/observacao geral (type=unknown sem informacao parcial nenhuma).",
    },
    day_of_month: {
      type: "number",
      description: "Dia do mes (1 a 31) em que o gasto fixo deve ser lancado automaticamente (so para type=set_recurring_expense).",
    },
    likely_intent: {
      type: "string",
      enum: ["expense", "event", "reminder"],
      description:
        "So para type=unknown: se a mensagem foi uma tentativa curta/incompleta de um desses tipos (faltou valor, data, etc.), qual pareceu ser. Deixe de fora se nao deu pra identificar nem isso.",
    },
    topic: {
      type: "string",
      enum: [
        "expense",
        "event",
        "reminder",
        "budget",
        "expense_report",
        "edit_expense",
        "category",
        "payment_method",
        "welcome",
        "recurring_expense",
        "income",
      ],
      description:
        "So para type=help: sobre qual assunto especifico e a duvida do usuario, pra responder com um exemplo direcionado em vez do catalogo inteiro. 'welcome' e so quando o usuario pede EXPLICITAMENTE pra ver/reenviar a mensagem de boas-vindas (ex: 'manda a mensagem de boas-vindas', 'reenvia as boas-vindas', 'quero ver a mensagem de novo usuario') — diferente de uma pergunta generica tipo 'o que voce faz', que deve deixar 'topic' em branco.",
    },
    date: {
      type: "string",
      description:
        "Data ISO 8601 do gasto (type=expense), o dia da compra/1a parcela (type=installment_expense, opcional -- sem mencao assume hoje), o dia especifico a listar (type=list_expenses, so a data), ou o dia JA CONHECIDO (YYYY-MM-DD) de um evento/lembrete parcial (type=unknown com likely_intent='event'/'reminder', se o usuario ja mencionou o dia mas nao o horario, ou vice-versa).",
    },
    time: {
      type: "string",
      description:
        "Horario JA CONHECIDO, formato 'HH:MM' em 24h (so para type=unknown com likely_intent='event'/'reminder'), se o usuario ja mencionou o horario mas nao o dia (ou os dois, junto com 'date'). Deixe vazio se o horario nao foi mencionado.",
    },
    title: {
      type: "string",
      description:
        "Titulo do evento (type=event, ou o titulo/assunto JA CONHECIDO de um evento parcial em type=unknown com likely_intent='event'). Use as palavras do proprio usuario da forma mais literal possivel (ex: 'atender Carol', 'manicure', 'dentista') -- NAO invente nem reescreva numa outra forma/grafia, e NUNCA mude a ortografia de uma palavra que ja existe em portugues (ex: a palavra 'manicure' continua exatamente 'manicure', nunca virar 'manicuri' ou qualquer variacao parecida). So capitalize a primeira letra se fizer sentido, sem alterar mais nada.",
    },
    start: {
      type: "string",
      description:
        "Data/hora ISO 8601 de inicio (so para type=event), no horario local de Brasilia (nao UTC). Inclua o offset explicito '-03:00' no final (ex: '2026-08-27T15:00:00-03:00'), nunca deixe sem offset.",
    },
    end: {
      type: "string",
      description:
        "Data/hora ISO 8601 de fim, opcional (so para type=event), no horario local de Brasilia (nao UTC). Inclua o offset explicito '-03:00' no final, igual 'start'.",
    },
    location: { type: "string", description: "Local do evento, opcional (so para type=event)" },
    query: {
      type: "string",
      description:
        "Palavra-chave pra buscar o item: o titulo do evento (type=delete_event ou type=edit_event), a mensagem do lembrete (type=edit_reminder), a descricao do gasto (type=correct_category ou type=edit_expense, opcional — se omitido em correct_category, aplica no gasto mais recente. Em edit_expense, so preencha se NAO usar list_ref), a descricao do gasto fixo a remover (type=remove_recurring_expense), ou a palavra que a descricao dos gastos precisa ter (type=bulk_recategorize, so quando scope='keyword').",
    },
    new_date: {
      type: "string",
      description:
        "Novo dia, formato 'YYYY-MM-DD' (type=edit_event ou type=edit_reminder), SO se o usuario mencionou um dia novo pra remarcar. Deixe vazio se ele so mudou o horario -- nesse caso o sistema mantem a data original sozinho, nao invente uma.",
    },
    new_time: {
      type: "string",
      description:
        "Nova hora, formato 'HH:MM' em 24h, horario de Brasilia (type=edit_event ou type=edit_reminder), SO se o usuario mencionou um horario novo pra remarcar. Deixe vazio se ele so mudou o dia -- nesse caso o sistema mantem o horario original sozinho, nao invente um.",
    },
    list_ref: {
      type: "number",
      description:
        "So para type=edit_expense: numero (1, 2, 3...) de um gasto na ultima lista de gastos mostrada (ex: 'edita o 2'). Nao preencher junto com 'query'.",
    },
    field: {
      type: "string",
      enum: ["amount", "date", "description", "payment_method"],
      description: "Qual campo do gasto mudar (so para type=edit_expense).",
    },
    value: {
      type: "string",
      description:
        "Novo valor do campo (so para type=edit_expense): numero pro amount (ex: '45.90'), data ISO 8601 (so a data) pro date, texto pra description, ou nome da forma de pagamento pro payment_method (prefira uma das ja existentes informadas no system prompt).",
    },
    message: {
      type: "string",
      description:
        "Texto do lembrete (type=reminder, ou o texto JA CONHECIDO de um lembrete parcial em type=unknown com likely_intent='reminder').",
    },
    due_at: {
      type: "string",
      description:
        "Data/hora ISO 8601 em que o lembrete deve ser enviado (so para type=reminder), no horario local de Brasilia (nao UTC). Inclua o offset explicito '-03:00' no final (ex: '2026-08-27T20:00:00-03:00'), nunca deixe sem offset.",
    },
    days: {
      type: "number",
      description:
        "Quantidade de dias a frente pro relatorio de agenda (type=report, se nao especificar use 7), quantidade de dias pra tras ate hoje pro resumo de gastos ou lista de gastos (type=expense_report ou type=list_expenses, so quando o usuario menciona um numero de dias especifico, ex: 'ultimos 15 dias'), ou pro periodo de bulk_recategorize (scope='period').",
    },
    period: {
      type: "string",
      enum: ["week", "month"],
      description:
        "Periodo do resumo de gastos (type=expense_report ou type=bulk_recategorize com scope='period', so quando 'days' nao foi usado): 'week' pros ultimos 7 dias, 'month' pro mes atual. Se o usuario nao especificar nem period nem um numero de dias em expense_report, use period='month'.",
    },
    month: {
      type: "string",
      description:
        "Mes especifico no formato 'YYYY-MM' (so para type=report, quando o usuario pede a agenda de um MES nomeado, ex: 'agenda de novembro' -> resolva o ano certo). Nao preencher junto com 'days'.",
    },
    day_of_week: {
      type: "string",
      enum: ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"],
      description: "Dia da semana escolhido pro relatorio semanal automatico (so para type=set_report_day).",
    },
  },
  required: ["type"],
};

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "record_actions",
  description:
    "Classifica a mensagem do usuario em uma ou mais acoes estruturadas. A maioria das mensagens tem 1 pedido so, mas se o usuario pedir mais de uma coisa na mesma mensagem (ex: 'marca dentista amanha e reuniao sexta'), inclua uma entrada em 'actions' para cada pedido identificado.",
  input_schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        description: "Uma entrada para cada pedido/acao identificado na mensagem, na ordem em que aparecem.",
        items: ACTION_SCHEMA,
      },
    },
    required: ["actions"],
  },
};

// "now" em UTC vira o dia seguinte antes da meia-noite em Sao Paulo (UTC-3): passar
// a data em UTC pro prompt fazia a IA achar que "hoje" ja era amanha nesse intervalo.
// Formata direto no horario de Brasilia pra "hoje"/"amanha"/etc sempre baterem certo.
const spNowFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function buildSystemPrompt(fromNumber: string) {
  const now = spNowFormatter.format(new Date()).replace(" ", "T");
  const categoryNames = listCategories(fromNumber)
    .map((c) => c.name)
    .join(", ");
  const paymentMethodNames = listPaymentMethods(fromNumber)
    .map((p) => p.name)
    .join(", ");
  return `Voce interpreta mensagens de WhatsApp de um assistente pessoal. Data/hora atual: ${now}-03:00, horario de Brasilia (America/Sao_Paulo, UTC-3 o ano todo, sem horario de verao).
Sempre chame a ferramenta record_actions com o resultado. Datas relativas ("hoje", "amanha", "sexta que vem") devem ser convertidas para ISO 8601 com base NESSA data/hora de Brasilia, nao em UTC — preste atencao especial perto da meia-noite, onde a data em UTC ja pode ter virado o dia seguinte. Campos de data/hora com horario (start, end, due_at) SEMPRE devem terminar com o offset explicito "-03:00" (ex: "2026-08-27T15:00:00-03:00"), nunca sem offset — isso e essencial pra hora nao vir adiantada/atrasada quando o sistema processar.
Se a mensagem tiver mais de um pedido (ex: dois eventos, ou um gasto e um lembrete), retorne uma acao para cada um dentro de "actions". Cada pedido usa SO as informacoes que sao claramente dele -- um dia/horario mencionado perto de UM pedido NAO deve "vazar" pra outro pedido da mesma mensagem que nao mencionou nenhum dia/horario proprio, mesmo que os dois estejam na mesma frase. Nunca preencha 'date'/'start'/'due_at' com "hoje" so por preencher -- so use "hoje" se o usuario disse isso explicitamente (ou algo equivalente tipo "agora", "daqui a pouco") pra ESSE pedido especifico; se um pedido simplesmente nao mencionou nenhum dia, o campo de data dele fica vazio (ou o pedido vira 'unknown' se data for obrigatoria pro tipo).

Categorias de gasto ja existentes: ${categoryNames}.
Ao classificar um gasto, se a compra claramente se encaixa numa dessas categorias, use exatamente esse nome.
Caso contrario, NAO forcar em "Outros" nem em nenhuma outra so por existir — de o nome de categoria mais especifico e natural pra aquele tipo de compra (ex: "Pets", "Beleza", "Presentes"), mesmo que seja uma categoria nova. Outra parte do sistema decide se essa categoria precisa ser confirmada com o usuario.

Formas de pagamento ja existentes: ${paymentMethodNames}. So preencha payment_method se o usuario mencionar explicitamente como pagou (ex: "no pix", "no cartao nubank") — se nao mencionar, deixe em branco, o sistema usa a forma padrao do usuario automaticamente.

Se a mensagem for curta e so sinalizar a intencao, sem os dados minimos pra completar a acao (ex: "gasto", "criar gasto", "cadastrar compra", "quero add uma compra", "evento", "lembrete"), NAO tente forcar um type=expense/event/reminder incompleto. Classifique como "unknown" e preencha "likely_intent" com o tipo mais provavel, pra pedir os detalhes que faltam.`;
}

async function classify(fromNumber: string, content: Anthropic.MessageParam["content"]): Promise<Interpretation[]> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1536,
    system: buildSystemPrompt(fromNumber),
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "record_actions" },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return [{ type: "unknown", description: "Modelo nao retornou classificacao" }];
  }

  const input = toolUse.input as { actions?: Interpretation[] };
  return input.actions?.length ? input.actions : [{ type: "unknown", description: "Nenhuma acao identificada" }];
}

export async function interpretText(fromNumber: string, text: string): Promise<Interpretation[]> {
  return classify(fromNumber, text);
}

export type ReceiptReading =
  | { isReceipt: false }
  | {
      isReceipt: true;
      description: string;
      date: string;
      totalAmount?: number;
      installmentAmount?: number;
      installments?: number;
      category?: string;
      paymentMethod?: string;
    };

const READ_RECEIPT_TOOL: Anthropic.Tool = {
  name: "read_receipt",
  description: "Le uma foto de comprovante/nota fiscal de compra e extrai os dados do gasto.",
  input_schema: {
    type: "object",
    properties: {
      is_receipt: {
        type: "boolean",
        description: "false se a imagem NAO parecer um comprovante/nota fiscal de compra, ou estiver ilegivel a ponto de nao dar pra ler nem o valor.",
      },
      description: {
        type: "string",
        description: "Nome do estabelecimento ou do que foi a compra, da forma mais literal possivel (ex: 'Posto Ipiranga', 'Supermercado Extra', 'Restaurante do Zé').",
      },
      date: {
        type: "string",
        description: "Data da compra impressa no comprovante, formato YYYY-MM-DD. Omita se nao conseguir ler nenhuma data -- NAO invente, o sistema assume hoje sozinho nesse caso.",
      },
      total_amount: {
        type: "number",
        description: "Valor TOTAL da compra (rodape, rotulado 'TOTAL'/'VALOR PAGO'/'VALOR A PAGAR') -- NUNCA some itens manualmente nem pegue o subtotal de um produto especifico. Preencher SO se a compra nao for parcelada, OU se o valor total (nao o de cada parcela) estiver explicito no comprovante.",
      },
      installment_amount: {
        type: "number",
        description: "Valor de CADA parcela, SE a compra for parcelada e o comprovante mostrar o valor por parcela (comum em comprovante de cartao). Nao preencher junto com 'total_amount' -- se os dois vierem no cupom, prefira preencher so um (o que estiver mais destacado).",
      },
      installments: {
        type: "number",
        description: "Quantidade de parcelas, SE o comprovante indicar parcelamento (ex: '3X SEM JUROS', 'PARC 01/03' -> 3). Omita se a compra for a vista (nao parcelada) ou nao houver nenhuma indicacao de parcelamento.",
      },
      category: {
        type: "string",
        description:
          "Categoria do gasto, inferida pelo tipo de estabelecimento (ex: posto de gasolina -> Veiculo, mercado/supermercado -> Mercado, restaurante/lanchonete -> Alimentacao, farmacia -> Saude). Prefira uma das categorias existentes do usuario quando fizer sentido; se nao tiver como identificar o tipo de estabelecimento com confianca, deixe vazio -- o sistema pergunta ao usuario.",
      },
      payment_method: {
        type: "string",
        description:
          "Forma de pagamento, SO se estiver impressa e legivel no comprovante (ex: 'CARTAO DEBITO', 'PIX', 'DINHEIRO'). NUNCA suponha -- se nao vier impressa ou nao der pra ler com confianca, deixe vazio, o sistema pergunta ao usuario.",
      },
    },
    required: ["is_receipt"],
  },
};

// Le uma foto de comprovante/nota fiscal (tool/schema dedicado, mais focado e
// mais barato que reaproveitar o classificador generico de 26 acoes). O
// resultado NUNCA e aplicado direto -- o router sempre monta uma confirmacao
// antes de registrar (foto erra mais que texto digitado), preenchendo so o
// que faltar (categoria/forma de pagamento) antes de mostrar o resumo final.
export async function interpretReceiptImage(fromNumber: string, imageBase64: string, mediaType: string): Promise<ReceiptReading> {
  const categoryNames = listCategories(fromNumber)
    .map((c) => c.name)
    .join(", ");
  const paymentMethodNames = listPaymentMethods(fromNumber)
    .map((p) => p.name)
    .join(", ");
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: `Voce le fotos de comprovante/nota fiscal de compra pra um assistente financeiro pessoal. Categorias de gasto ja existentes desse usuario: ${categoryNames}. Formas de pagamento ja existentes: ${paymentMethodNames}. Sempre chame a ferramenta read_receipt com o resultado.`,
    tools: [READ_RECEIPT_TOOL],
    tool_choice: { type: "tool", name: "read_receipt" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageBase64 } },
          { type: "text", text: "Essa imagem e um comprovante/nota fiscal de compra. Extraia os dados do gasto." },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { isReceipt: false };

  const input = toolUse.input as {
    is_receipt?: boolean;
    description?: string;
    date?: string;
    total_amount?: number;
    installment_amount?: number;
    installments?: number;
    category?: string;
    payment_method?: string;
  };
  if (!input.is_receipt || (input.total_amount === undefined && input.installment_amount === undefined)) {
    return { isReceipt: false };
  }

  return {
    isReceipt: true,
    description: input.description?.trim() || "Compra",
    date: input.date?.trim() || spDateStringForReceipt(),
    totalAmount: typeof input.total_amount === "number" ? input.total_amount : undefined,
    installmentAmount: typeof input.installment_amount === "number" ? input.installment_amount : undefined,
    installments: typeof input.installments === "number" && input.installments > 1 ? input.installments : undefined,
    category: input.category?.trim() || undefined,
    paymentMethod: input.payment_method?.trim() || undefined,
  };
}

// mesma formatacao de spDateString (src/timeSP.ts), reimplementada aqui pra
// nao criar um ciclo de import entre timeSP.ts e interpret.ts so por isso
function spDateStringForReceipt(): string {
  return spNowFormatter.format(new Date()).slice(0, 10);
}

const EXTRACT_RECEIPT_CORRECTION_TOOL: Anthropic.Tool = {
  name: "extract_receipt_correction",
  description: "Extrai os campos que o usuario quis corrigir numa resposta livre ao resumo de um gasto lido de foto de comprovante.",
  input_schema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "Novo valor TOTAL em reais, SO se a mensagem corrigiu o valor. Omita se nao mencionou valor." },
      description: { type: "string", description: "Nova descricao/estabelecimento, SO se a mensagem corrigiu isso. Omita se nao mencionou." },
      category: { type: "string", description: "Nova categoria, SO se a mensagem corrigiu isso. Omita se nao mencionou." },
      payment_method: { type: "string", description: "Nova forma de pagamento, SO se a mensagem corrigiu isso. Omita se nao mencionou." },
      date: { type: "string", description: "Nova data (YYYY-MM-DD), SO se a mensagem corrigiu isso. Omita se nao mencionou." },
      installments: { type: "number", description: "Nova quantidade de parcelas, SO se a mensagem corrigiu isso. Omita se nao mencionou." },
    },
    required: [],
  },
};

// Usado quando o usuario responde ao resumo "li assim: ... confirma?" com uma
// correcao em texto livre (ex: "nao, foi no debito") em vez de "sim"/"nao" --
// mesma ideia de extractExpenseInfoFromAnswer, mas cobrindo todos os campos
// possiveis de um gasto lido de imagem.
export async function extractReceiptCorrectionFromAnswer(answerText: string): Promise<{
  amount?: number;
  description?: string;
  category?: string;
  paymentMethod?: string;
  date?: string;
  installments?: number;
} | null> {
  const now = spNowFormatter.format(new Date()).replace(" ", "T");
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: `Data/hora atual: ${now}-03:00, horario de Brasilia. Extraia SO os campos que a mensagem do usuario corrigiu explicitamente sobre um gasto (valor, descricao, categoria, forma de pagamento, data, quantidade de parcelas). Deixe de fora qualquer campo que a mensagem nao mencionou.`,
    tools: [EXTRACT_RECEIPT_CORRECTION_TOOL],
    tool_choice: { type: "tool", name: "extract_receipt_correction" },
    messages: [{ role: "user", content: answerText }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const input = toolUse.input as {
    amount?: number;
    description?: string;
    category?: string;
    payment_method?: string;
    date?: string;
    installments?: number;
  };
  const amount = typeof input.amount === "number" ? input.amount : undefined;
  const description = input.description?.trim() || undefined;
  const category = input.category?.trim() || undefined;
  const paymentMethod = input.payment_method?.trim() || undefined;
  const date = input.date?.trim() || undefined;
  const installments = typeof input.installments === "number" ? input.installments : undefined;
  if (
    amount === undefined &&
    description === undefined &&
    category === undefined &&
    paymentMethod === undefined &&
    date === undefined &&
    installments === undefined
  ) {
    return null;
  }
  return { amount, description, category, paymentMethod, date, installments };
}

const EXTRACT_CATEGORY_TOOL: Anthropic.Tool = {
  name: "extract_category",
  description: "Extrai o nome da categoria de gasto que o usuario quis dizer, mesmo que a resposta seja uma frase.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", description: "So o nome da categoria, curto (ex: 'Pets', 'Beleza'), sem mais nada da frase." },
    },
    required: ["category"],
  },
};

// Usado quando o usuario responde "qual categoria e isso?" com uma frase natural
// em vez de so o nome, ex: "acho que da pra colocar em pets".
export async function extractCategoryFromAnswer(answerText: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    tools: [EXTRACT_CATEGORY_TOOL],
    tool_choice: { type: "tool", name: "extract_category" },
    messages: [{ role: "user", content: answerText }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return answerText.trim();
  const input = toolUse.input as { category?: string };
  return input.category?.trim() || answerText.trim();
}

const EXTRACT_DATETIME_TOOL: Anthropic.Tool = {
  name: "extract_datetime",
  description: "Extrai a data e/ou a hora que o usuario quis dizer numa frase livre de ajuste, separadamente.",
  input_schema: {
    type: "object",
    properties: {
      new_date: {
        type: "string",
        description: "Novo dia, formato 'YYYY-MM-DD', SO se a mensagem mencionou um dia. Omita se so mencionou horario, ou nao mencionou nenhuma data.",
      },
      new_time: {
        type: "string",
        description: "Nova hora, formato 'HH:MM' em 24h, SO se a mensagem mencionou um horario. Omita se so mencionou data, ou nao mencionou nenhum horario.",
      },
    },
    required: [],
  },
};

// Usado quando o usuario responde "confirma essa data/hora?" com um ajuste em
// frase livre (ex: "na verdade e sexta", so o dia, mantendo o horario que ja
// tinha sido proposto) em vez de so "sim"/"nao" -- mesma ideia do
// extractCategoryFromAnswer, mas pra data/hora de evento/lembrete. Retorna os
// dois campos SEPARADOS (nao um datetime combinado) pra quem chama poder
// preencher so o que foi mencionado e manter o resto do valor ja proposto,
// sem perder informacao que o usuario nao pediu pra mudar.
export async function extractDateTimeFromAnswer(answerText: string): Promise<{ newDate?: string; newTime?: string } | null> {
  const now = spNowFormatter.format(new Date()).replace(" ", "T");
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system: `Data/hora atual: ${now}-03:00, horario de Brasilia (America/Sao_Paulo, UTC-3 o ano todo, sem horario de verao). Extraia a data e/ou a hora que a mensagem do usuario menciona, com base NESSA data/hora atual. Preencha SO o que foi mencionado -- se a mensagem so falou do dia, deixe 'new_time' vazio; se so falou da hora, deixe 'new_date' vazio.`,
    tools: [EXTRACT_DATETIME_TOOL],
    tool_choice: { type: "tool", name: "extract_datetime" },
    messages: [{ role: "user", content: answerText }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const input = toolUse.input as { new_date?: string; new_time?: string };
  const newDate = input.new_date?.trim() || undefined;
  const newTime = input.new_time?.trim() || undefined;
  if (!newDate && !newTime) return null;
  return { newDate, newTime };
}

const EXTRACT_EXPENSE_INFO_TOOL: Anthropic.Tool = {
  name: "extract_expense_info",
  description: "Extrai o valor em reais e/ou a descricao (do que foi a compra) de uma resposta em frase livre sobre um gasto.",
  input_schema: {
    type: "object",
    properties: {
      amount: {
        type: "number",
        description: "Valor em reais, SO se a mensagem mencionou um valor. Omita se nao mencionou nenhum valor.",
      },
      description: {
        type: "string",
        description: "Descricao curta do que foi o gasto, SO se a mensagem descreveu isso. Omita se nao descreveu.",
      },
    },
    required: [],
  },
};

// Usado quando o usuario responde a "quanto foi?"/"do que foi?" (gasto parcial,
// faltando valor e/ou descricao) com uma frase livre -- mesma ideia do
// extractDateTimeFromAnswer, mas pra valor/descricao de gasto. Preenche SO o
// que foi mencionado, pra quem chama poder completar so o que faltava.
export async function extractExpenseInfoFromAnswer(answerText: string): Promise<{ amount?: number; description?: string } | null> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system:
      "Extraia o valor em reais e/ou a descricao (do que foi a compra) que a mensagem do usuario menciona. Preencha SO o que foi mencionado -- se so falou o valor, deixe 'description' vazio; se so descreveu do que foi, deixe 'amount' vazio.",
    tools: [EXTRACT_EXPENSE_INFO_TOOL],
    tool_choice: { type: "tool", name: "extract_expense_info" },
    messages: [{ role: "user", content: answerText }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const input = toolUse.input as { amount?: number; description?: string };
  const amount = typeof input.amount === "number" ? input.amount : undefined;
  const description = input.description?.trim() || undefined;
  if (amount === undefined && description === undefined) return null;
  return { amount, description };
}

const EXTRACT_INSTALLMENT_INFO_TOOL: Anthropic.Tool = {
  name: "extract_installment_info",
  description: "Extrai a quantidade de parcelas, o valor total e/ou a descricao de uma resposta em frase livre sobre uma compra parcelada.",
  input_schema: {
    type: "object",
    properties: {
      installments: {
        type: "number",
        description: "Quantidade de parcelas (numero de vezes), SO se a mensagem mencionou isso (ex: 'em 3 vezes' -> 3, '4x' -> 4). Omita se nao mencionou.",
      },
      amount: {
        type: "number",
        description: "Valor TOTAL da compra em reais, SO se a mensagem mencionou um valor. Omita se nao mencionou nenhum valor.",
      },
      description: {
        type: "string",
        description: "Descricao curta do que foi a compra, SO se a mensagem descreveu isso. Omita se nao descreveu.",
      },
    },
    required: [],
  },
};

// Usado quando o usuario responde a "em quantas vezes?"/"quanto foi?"/"do que
// foi?" (compra parcelada incompleta) com uma frase livre -- mesma ideia do
// extractExpenseInfoFromAnswer, com o campo extra de parcelas. O valor
// extraido aqui e sempre tratado como TOTAL da compra (o sistema so pergunta
// o valor quando nenhum dos dois -- total ou por parcela -- ainda era conhecido).
export async function extractInstallmentInfoFromAnswer(
  answerText: string
): Promise<{ installments?: number; amount?: number; description?: string } | null> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    system:
      "Extraia a quantidade de parcelas, o valor total em reais e/ou a descricao (do que foi a compra) que a mensagem do usuario menciona. Preencha SO o que foi mencionado, deixando os outros campos vazios.",
    tools: [EXTRACT_INSTALLMENT_INFO_TOOL],
    tool_choice: { type: "tool", name: "extract_installment_info" },
    messages: [{ role: "user", content: answerText }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const input = toolUse.input as { installments?: number; amount?: number; description?: string };
  const installments = typeof input.installments === "number" ? input.installments : undefined;
  const amount = typeof input.amount === "number" ? input.amount : undefined;
  const description = input.description?.trim() || undefined;
  if (installments === undefined && amount === undefined && description === undefined) return null;
  return { installments, amount, description };
}
