/**
 * Drizzle `BillingRunRepository` (ADR 0020) — server-impl. Org-scopar via join
 * mot ärendet; left-joinar fakturan (+ ärende-detaljer i byId).
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BillingRun } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";
import { billingRuns, invoices, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import type {
  BillingRunDetailRow, BillingRunListRow, BillingRunRepository,
} from "./billing-run-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";

export class DrizzleBillingRunRepository
  extends DrizzleRepository<BillingRun>
  implements BillingRunRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(billingRuns), now);
  }

  async listForOrg(organizationId: string, matterId?: string): Promise<BillingRunListRow[]> {
    const rows = await this.db
      .select({
        run: billingRuns,
        invId: invoices.id, invNum: invoices.invoiceNumber, invStatus: invoices.status,
      })
      .from(billingRuns)
      .innerJoin(matters, eq(billingRuns.matterId, matters.id))
      .leftJoin(invoices, eq(billingRuns.invoiceId, invoices.id))
      .where(and(
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        matterId ? eq(billingRuns.matterId, asId<"MatterId">(matterId)) : undefined,
        isNull(billingRuns.deletedAt),
      ))
      .orderBy(desc(billingRuns.createdAt));
    return rows.map((r): BillingRunListRow => ({
      ...r.run,
      invoice: r.invId ? { id: r.invId, invoiceNumber: r.invNum, status: r.invStatus as string } : null,
    }));
  }

  async getByIdInOrg(id: string, organizationId: string): Promise<BillingRunDetailRow | null> {
    const rows = await this.db
      .select({
        run: billingRuns,
        invId: invoices.id, invNum: invoices.invoiceNumber, invStatus: invoices.status, invAmount: invoices.amount,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title, mPay: matters.paymentMethod,
      })
      .from(billingRuns)
      .innerJoin(matters, eq(billingRuns.matterId, matters.id))
      .leftJoin(invoices, eq(billingRuns.invoiceId, invoices.id))
      .where(and(eq(billingRuns.id, asId<"BillingRunId">(id)), eq(matters.organizationId, asId<"OrganizationId">(organizationId)), isNull(billingRuns.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r.run,
      invoice: r.invId
        ? { id: r.invId, invoiceNumber: r.invNum, status: r.invStatus as string, amount: Number(r.invAmount ?? 0) }
        : null,
      matter: r.mId
        ? { id: r.mId, matterNumber: r.mNum, title: r.mTitle, paymentMethod: r.mPay ?? null }
        : null,
    };
  }

  async listAccontoSent(matterId: string): Promise<BillingRun[]> {
    const rows = await this.db
      .select().from(billingRuns)
      .where(and(
        eq(billingRuns.matterId, asId<"MatterId">(matterId)), eq(billingRuns.type, "ACCONTO"),
        eq(billingRuns.status, "SENT"), isNull(billingRuns.deletedAt),
      ));
    return rows;
  }

  async listAccontoByIds(matterId: string, ids: string[]): Promise<BillingRun[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select().from(billingRuns)
      .where(and(
        inArray(billingRuns.id, ids.map((i) => asId<"BillingRunId">(i))), eq(billingRuns.matterId, asId<"MatterId">(matterId)),
        eq(billingRuns.type, "ACCONTO"), isNull(billingRuns.deletedAt),
      ));
    return rows;
  }
}
