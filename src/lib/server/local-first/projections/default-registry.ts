/**
 * `buildDefaultRegistry()` — fabriksfunktion som returnerar en
 * `ProjectionRegistry` förkonfigurerad med alla projektioner som
 * `LocalGitStore` levererar idag.
 */

import { ProjectionRegistry } from "./registry";
import { MatterProjection } from "./matter";
import { ContactProjection } from "./contact";
import { UserProjection } from "./user";
import { MatterContactProjection } from "./matter-contact";
import { DocumentProjection } from "./document";
import { TimeEntryProjection } from "./time-entry";
import { ExpenseProjection } from "./expense";
import { InvoiceProjection } from "./invoice";
import { GenericProjection } from "./generic";

export function buildDefaultRegistry(): ProjectionRegistry {
  const r = new ProjectionRegistry();

  // Strikta projektioner — använder per-entitet zod-schema
  r.register({ entity: "matter", projection: new MatterProjection(), ownsPath: (p) => p.startsWith("matters/") });
  r.register({ entity: "contact", projection: new ContactProjection(), ownsPath: (p) => p.startsWith("contacts/") });
  r.register({ entity: "user", projection: new UserProjection(), ownsPath: (p) => p.startsWith(".ava/users/") });
  r.register({ entity: "matterContact", projection: new MatterContactProjection(), ownsPath: (p) => p.startsWith("matter-contacts/") });
  r.register({ entity: "document", projection: new DocumentProjection(), ownsPath: (p) => p.startsWith("documents/") && !p.startsWith("documents/content/") && !p.startsWith("documents/text/") });
  r.register({ entity: "timeEntry", projection: new TimeEntryProjection(), ownsPath: (p) => p.startsWith("time-entries/") });
  r.register({ entity: "expense", projection: new ExpenseProjection(), ownsPath: (p) => p.startsWith("expenses/") });
  r.register({ entity: "invoice", projection: new InvoiceProjection(), ownsPath: (p) => p.startsWith("invoices/") });

  // Passthrough-projektioner för entiteter utan strikt schema. Tidigare
  // saknades dessa → ProjectionHydrator hoppade över filerna →
  // kalendern, avbetalningarna, mallarna m.fl. visade tomma listor.
  r.register({ entity: "calendarEvent", projection: new GenericProjection("calendar"), ownsPath: (p) => p.startsWith("calendar/") });
  r.register({ entity: "paymentPlan", projection: new GenericProjection("payment-plans"), ownsPath: (p) => p.startsWith("payment-plans/") });
  r.register({ entity: "payment", projection: new GenericProjection("payments"), ownsPath: (p) => p.startsWith("payments/") });
  r.register({ entity: "paymentPlanReminder", projection: new GenericProjection("payment-plan-reminders"), ownsPath: (p) => p.startsWith("payment-plan-reminders/") });
  r.register({ entity: "task", projection: new GenericProjection("tasks"), ownsPath: (p) => p.startsWith("tasks/") });
  r.register({ entity: "conflictCheck", projection: new GenericProjection("conflict-checks"), ownsPath: (p) => p.startsWith("conflict-checks/") });
  r.register({ entity: "documentTemplate", projection: new GenericProjection(".ava/templates"), ownsPath: (p) => p.startsWith(".ava/templates/") });
  r.register({ entity: "organization", projection: new GenericProjection(".ava/organizations"), ownsPath: (p) => p.startsWith(".ava/organizations/") });
  r.register({ entity: "office", projection: new GenericProjection("offices"), ownsPath: (p) => p.startsWith("offices/") });
  r.register({ entity: "userPreference", projection: new GenericProjection(".ava/user-preferences"), ownsPath: (p) => p.startsWith(".ava/user-preferences/") });
  r.register({ entity: "orgPreference", projection: new GenericProjection(".ava/org-preferences"), ownsPath: (p) => p.startsWith(".ava/org-preferences/") });

  return r;
}
