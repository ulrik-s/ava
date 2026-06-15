/**
 * Relations-grafen för `DemoDataStore`.
 *
 * Den deklarativa relations-wiringen (matters→contacts→invoices→payments→
 * accontoDeductions …) bodde tidigare i `DemoDataStore`-konstruktorn. Den är
 * ren konfiguration — separerad hit så datalager-klassen bara äger
 * delegate-factory + transaktionsmotor, och relations-grafen blir granskbar
 * för sig (#189).
 *
 * Designval: `buildRelations` tar en `getSource`-accessor (INTE ett
 * `DemoSource`-objekt) så att collections alltid läser den AKTUELLA
 * source-referensen — mutable-läget byter ut `this.source` via `mergeSource`,
 * och en infrusen referens skulle peka på gammal data.
 */

import type { DemoSource } from "@/lib/shared/demo-source";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { RelationConfig } from "./in-memory/read-only-delegate";

type GetSource = () => DemoSource;
type Relations = Record<string, RelationConfig<Record<string, unknown>>>;

/**
 * En `rel`-builder bunden till en source-accessor: barn-collection `key`,
 * kopplad via `child[childField] === parent[parentField]`. `relations` ger
 * nested include/where-stöd. `kind` defaultar "many" (endast "one" särbehandlas
 * i delegaten — undefined och "many" är ekvivalenta).
 */
type Rel = (
  key: keyof DemoSource,
  childField: string,
  parentField: string,
  kind?: "one" | "many",
  relations?: Relations,
) => RelationConfig<Record<string, unknown>>;

function makeRel(getSource: GetSource): Rel {
  return (key, childField, parentField, kind = "many", relations) => {
    const cfg = omitUndefined({
      kind,
      collection: () => (getSource()[key] ?? []) as readonly Record<string, unknown>[],
      where: (p: Record<string, unknown>) => ({ [childField]: p[parentField] }),
      relations,
    });
    return cfg as RelationConfig<Record<string, unknown>>;
  };
}

export interface DemoRelations {
  matters: Relations;
  matterContacts: Relations;
  contacts: Relations;
  documents: Relations;
  documentTemplates: Relations;
  invoices: Relations;
  invoiceDispatches: Relations;
  timeEntries: Relations;
  expenses: Relations;
  conflictChecks: Relations;
  paymentPlans: Relations;
  billingRuns: Relations;
  calendarEvents: Relations;
  tasks: Relations;
  serviceNotes: Relations;
}

/**
 * Bygg relations-mappen per entitet. Endast entiteter MED relationer listas;
 * övriga (users, offices, payments, writeOffs, …) skapas utan relations.
 */
export function buildRelations(getSource: GetSource): DemoRelations {
  const r = makeRel(getSource);
  return {
    matters: {
      contacts: r("matterContacts", "matterId", "id"),
      documents: r("documents", "matterId", "id"),
      timeEntries: r("timeEntries", "matterId", "id"),
      expenses: r("expenses", "matterId", "id"),
      invoices: r("invoices", "matterId", "id"),
      serviceNotes: r("serviceNotes", "matterId", "id"),
    },
    matterContacts: {
      contact: r("contacts", "id", "contactId", "one"),
      // Nested-include från conflict.ts (matter.contacts.contact) kräver att
      // sub-relationerna registreras här, annars blir matter.contacts undefined.
      matter: r("matters", "id", "matterId", "one", {
        contacts: r("matterContacts", "matterId", "id", "many", {
          contact: r("contacts", "id", "contactId", "one"),
        }),
      }),
    },
    contacts: {
      matterLinks: r("matterContacts", "contactId", "id"),
      // Hierarki: UI:n kräver children som array (annars kraschade .map()).
      children: r("contacts", "parentId", "id"),
      parent: r("contacts", "id", "parentId", "one"),
    },
    // kind:"one" är AVGÖRANDE — annars matchas nested where `matter:
    // { organizationId }` mot en array → assertDocAccess NOT_FOUND (tidigare bugg).
    documents: { matter: r("matters", "id", "matterId", "one") },
    documentTemplates: { createdBy: r("users", "id", "createdById", "one") },
    invoices: {
      matter: r("matters", "id", "matterId", "one"),
      paymentPlan: r("paymentPlans", "invoiceId", "id", "one", {
        reminders: r("paymentPlanReminders", "planId", "id"),
      }),
      payments: r("payments", "invoiceId", "id", "many", {
        recordedBy: r("users", "id", "recordedById", "one"),
      }),
      writeOffs: r("writeOffs", "invoiceId", "id", "many"),
      invoiceDispatches: r("invoiceDispatches", "invoiceId", "id", "many"),
      accontoDeductions: r("accontoDeductions", "finalInvoiceId", "id", "many", {
        accontoInvoice: r("invoices", "id", "accontoInvoiceId", "one"),
      }),
      deductedOnFinals: r("accontoDeductions", "accontoInvoiceId", "id", "many", {
        finalInvoice: r("invoices", "id", "finalInvoiceId", "one"),
      }),
      timeEntries: r("timeEntries", "invoiceId", "id"),
      expenses: r("expenses", "invoiceId", "id"),
      documents: r("documents", "invoiceId", "id"), // genererade faktura-/underlag-dokument
      creditNote: r("invoices", "creditedInvoiceId", "id", "one"),
      creditedInvoice: r("invoices", "id", "creditedInvoiceId", "one"),
    },
    invoiceDispatches: {
      // dispatch→invoice→matter: ger workern faktura-detaljer (include) + org-
      // scoping i where (invoice.matter.organizationId), #180.
      invoice: r("invoices", "id", "invoiceId", "one", {
        matter: r("matters", "id", "matterId", "one"),
      }),
    },
    timeEntries: {
      user: r("users", "id", "userId", "one"),
      matter: r("matters", "id", "matterId", "one"),
      invoice: r("invoices", "id", "invoiceId", "one"),
    },
    expenses: {
      matter: r("matters", "id", "matterId", "one"),
      user: r("users", "id", "userId", "one"),
      invoice: r("invoices", "id", "invoiceId", "one"),
    },
    conflictChecks: { checkedBy: r("users", "id", "checkedById", "one") },
    // invoice (+ nested matter) krävs för cancelPaymentPlan:s where
    // `invoice: { matter: { organizationId } }`.
    paymentPlans: {
      invoice: r("invoices", "id", "invoiceId", "one", {
        matter: r("matters", "id", "matterId", "one", {
          contacts: r("matterContacts", "matterId", "id"),
        }),
        payments: r("payments", "invoiceId", "id"),
      }),
      reminders: r("paymentPlanReminders", "planId", "id"),
    },
    billingRuns: {
      invoice: r("invoices", "id", "invoiceId", "one"),
      matter: r("matters", "id", "matterId", "one"),
    },
    calendarEvents: { matter: r("matters", "id", "matterId", "one") },
    tasks: { matter: r("matters", "id", "matterId", "one") },
    serviceNotes: {
      matter: r("matters", "id", "matterId", "one"),
      author: r("users", "id", "authorId", "one"),
    },
  };
}
