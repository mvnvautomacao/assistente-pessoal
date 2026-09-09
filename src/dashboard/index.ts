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
dashboardRouter.use(requireDashboardSession);
dashboardRouter.use(expensesRouter);
dashboardRouter.use(incomesRouter);
dashboardRouter.use(categoriesRouter);
dashboardRouter.use(paymentMethodsRouter);
dashboardRouter.use(eventsRouter);
dashboardRouter.use(remindersRouter);
