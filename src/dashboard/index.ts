import { Router } from "express";
import { expensesRouter } from "./expenses";
import { incomesRouter } from "./incomes";
import { categoriesRouter } from "./categories";
import { paymentMethodsRouter } from "./paymentMethods";
import { eventsRouter } from "./events";
import { remindersRouter } from "./reminders";
import { dashboardAuthRouter, requireDashboardSession } from "./auth";

export const dashboardRouter = Router();
// rotas de login/pedir-senha/logout precisam vir ANTES da trava de sessao
// (senao ninguem conseguiria logar -- galinha e ovo).
dashboardRouter.use(dashboardAuthRouter);
// path "/dashboard" explicito aqui e essencial: sem ele, esse middleware
// intercepta QUALQUER rota que passe pelo dashboardRouter (que e montado sem
// prefixo em index.ts), inclusive /health -- foi exatamente isso que quebrou
// o healthcheck em producao (Coolify via requisicao pra /health, cai aqui
// sem sessao, e recebe a tela de login em vez de "ok"). Mesmo ajuste ja feito
// pro adminRouter (ver src/admin.ts).
dashboardRouter.use("/dashboard", requireDashboardSession);
dashboardRouter.use(expensesRouter);
dashboardRouter.use(incomesRouter);
dashboardRouter.use(categoriesRouter);
dashboardRouter.use(paymentMethodsRouter);
dashboardRouter.use(eventsRouter);
dashboardRouter.use(remindersRouter);
