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

export function buildDefaultRegistry(): ProjectionRegistry {
  const r = new ProjectionRegistry();

  r.register({ entity: "matter", projection: new MatterProjection(), ownsPath: (p) => p.startsWith("matters/") });
  r.register({ entity: "contact", projection: new ContactProjection(), ownsPath: (p) => p.startsWith("contacts/") });
  r.register({ entity: "user", projection: new UserProjection(), ownsPath: (p) => p.startsWith(".ava/users/") });
  r.register({ entity: "matterContact", projection: new MatterContactProjection(), ownsPath: (p) => p.startsWith("matter-contacts/") });
  r.register({ entity: "document", projection: new DocumentProjection(), ownsPath: (p) => p.startsWith("documents/") });
  r.register({ entity: "timeEntry", projection: new TimeEntryProjection(), ownsPath: (p) => p.startsWith("time-entries/") });
  r.register({ entity: "expense", projection: new ExpenseProjection(), ownsPath: (p) => p.startsWith("expenses/") });
  r.register({ entity: "invoice", projection: new InvoiceProjection(), ownsPath: (p) => p.startsWith("invoices/") });

  return r;
}
