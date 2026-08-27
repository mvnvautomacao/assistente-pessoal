import { Router } from "express";
import { expensesRouter } from "./expenses";
import { incomesRouter } from "./incomes";
import { categoriesRouter } from "./categories";
import { paymentMethodsRouter } from "./paymentMethods";
import { eventsRouter } from "./events";
import { remindersRouter } from "./reminders";

export const dashboardRouter = Router();
dashboardRouter.use(expensesRouter);
dashboardRouter.use(incomesRouter);
dashboardRouter.use(categoriesRouter);
dashboardRouter.use(paymentMethodsRouter);
dashboardRouter.use(eventsRouter);
dashboardRouter.use(remindersRouter);
