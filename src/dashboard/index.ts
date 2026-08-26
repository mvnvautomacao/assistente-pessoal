import { Router } from "express";
import { expensesRouter } from "./expenses";
import { categoriesRouter } from "./categories";
import { paymentMethodsRouter } from "./paymentMethods";
import { eventsRouter } from "./events";
import { remindersRouter } from "./reminders";

export const dashboardRouter = Router();
dashboardRouter.use(expensesRouter);
dashboardRouter.use(categoriesRouter);
dashboardRouter.use(paymentMethodsRouter);
dashboardRouter.use(eventsRouter);
dashboardRouter.use(remindersRouter);
