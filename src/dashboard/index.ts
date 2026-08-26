import { Router } from "express";
import { expensesRouter } from "./expenses";
import { categoriesRouter } from "./categories";
import { paymentMethodsRouter } from "./paymentMethods";

export const dashboardRouter = Router();
dashboardRouter.use(expensesRouter);
dashboardRouter.use(categoriesRouter);
dashboardRouter.use(paymentMethodsRouter);
