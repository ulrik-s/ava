import { router } from "../trpc";
import { contactRouter } from "./contact";
import { matterRouter } from "./matter";
import { timeEntryRouter } from "./timeEntry";
import { conflictRouter } from "./conflict";
import { documentRouter } from "./document";
import { expenseRouter } from "./expense";
import { userRouter } from "./user";
import { documentTemplateRouter } from "./documentTemplate";
import { organizationRouter } from "./organization";
import { reportsRouter } from "./reports";
import { invoiceRouter } from "./invoice";

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
});

export type AppRouter = typeof appRouter;
