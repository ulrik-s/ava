/**
 * `matterOrg` (#528) — härled `organizationId` för en matter-scopad entitet som
 * saknar egen org-kolumn (document, documentFolder, …) via dess ärende. Används
 * av repo:ernas `resolveOrg`-override så change_log får rätt org → de delta-
 * synkas via pull (annars hoppades de över; bara org-kolumn-bärande rader
 * loggades).
 */

import { eq } from "drizzle-orm";
import type { DocumentId, InvoiceId, MatterId, OrganizationId, PaymentPlanId, UserId } from "@/lib/shared/schemas/ids";
import { documents, invoices, matters, paymentPlans, users } from "../db/schema";
import type { AppDb } from "../db/types";

export async function matterOrg(db: AppDb, matterId: MatterId | null | undefined): Promise<OrganizationId | undefined> {
  if (!matterId) return undefined;
  const [m] = await db
    .select({ org: matters.organizationId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  return m?.org ?? undefined;
}

/**
 * Org via fakturan (#647) — för faktura-scopade entiteter utan egen org- eller
 * matter-kolumn (payment/writeOff/paymentPlan/accontoDeduction/invoiceDispatch):
 * faktura → ärende → org. Annars loggas de aldrig i change_log → syns ej i klienten.
 */
export async function invoiceOrg(db: AppDb, invoiceId: InvoiceId | null | undefined): Promise<OrganizationId | undefined> {
  if (!invoiceId) return undefined;
  const [inv] = await db
    .select({ matterId: invoices.matterId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return matterOrg(db, inv?.matterId);
}

/** Org via avbetalningsplanen (#647): plan → faktura → ärende → org. */
export async function planOrg(db: AppDb, planId: PaymentPlanId | null | undefined): Promise<OrganizationId | undefined> {
  if (!planId) return undefined;
  const [plan] = await db
    .select({ invoiceId: paymentPlans.invoiceId })
    .from(paymentPlans)
    .where(eq(paymentPlans.id, planId))
    .limit(1);
  return invoiceOrg(db, plan?.invoiceId);
}

/**
 * Org via dokumentet (#1242): dokument → ärende → org. Kontakt- och
 * händelseförslagen bär bara `documentId`; utan det här loggades de aldrig i
 * change_log och gick inte att byråavgränsa vid synk-push.
 */
export async function documentOrg(db: AppDb, documentId: DocumentId | null | undefined): Promise<OrganizationId | undefined> {
  if (!documentId) return undefined;
  const [doc] = await db
    .select({ matterId: documents.matterId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  return matterOrg(db, doc?.matterId);
}

/**
 * Org via användaren (#1344): jävskontrollens logg bär bara `checkedById`.
 * Utan det här gick loggen inte att byråavgränsa — vilken byrå som helst kunde
 * skapa eller skriva över rader, och historiken visade alla byråers sökningar.
 */
export async function userOrg(db: AppDb, userId: UserId | null | undefined): Promise<OrganizationId | undefined> {
  if (!userId) return undefined;
  const [u] = await db
    .select({ org: users.organizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.org ?? undefined;
}
