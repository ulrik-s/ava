import { router } from "../trpc";
import { billingRunRouter } from "./billingRun";
import { calendarRouter } from "./calendar";
import { conflictRouter } from "./conflict";
import { contactRouter } from "./contact";
import { documentRouter } from "./document";
import { documentTemplateRouter } from "./documentTemplate";
import { expectedReceivableRouter } from "./expectedReceivable";
import { expenseRouter } from "./expense";
import { invoiceRouter } from "./invoice";
import { invoiceDispatchRouter } from "./invoiceDispatch";
import { kostnadsrakningRouter } from "./kostnadsrakning";
import { mailRouter } from "./mail";
import { matterRouter } from "./matter";
import { organizationRouter } from "./organization";
import { paymentPlanRouter } from "./paymentPlan";
import { preferenceRouter } from "./preference";
import { reportsRouter } from "./reports";
import { serviceNoteRouter } from "./serviceNote";
import { syncRouter } from "./sync";
import { systemRouter } from "./system";
import { taskRouter } from "./task";
import { timeEntryRouter } from "./timeEntry";
import { todoRouter } from "./todo";
import { userRouter } from "./user";

export const appRouter = router({
  contacts: contactRouter,
  matter: matterRouter,
  timeEntry: timeEntryRouter,
  conflict: conflictRouter,
  document: documentRouter,
  expense: expenseRouter,
  user: userRouter,
  documentTemplate: documentTemplateRouter,
  organization: organizationRouter,
  reports: reportsRouter,
  invoice: invoiceRouter,
  invoiceDispatch: invoiceDispatchRouter,
  expectedReceivable: expectedReceivableRouter,
  billingRun: billingRunRouter,
  paymentPlan: paymentPlanRouter,
  kostnadsrakning: kostnadsrakningRouter,
  calendar: calendarRouter,
  task: taskRouter,
  serviceNote: serviceNoteRouter,
  todo: todoRouter,
  prefs: preferenceRouter,
  mail: mailRouter,
  sync: syncRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
