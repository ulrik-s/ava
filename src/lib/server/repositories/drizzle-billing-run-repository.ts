/**
 * Drizzle `BillingRunRepository` (ADR 0020) — server-impl. Org-scopar via join
 * mot ärendet; left-joinar fakturan (+ ärende-detaljer i byId).
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BillingRun } from "@/lib/shared/schemas/billing";
import { asId, type BillingRunId, type MatterId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { billingRuns, invoices, krReferences, matters } from "../db/schema";
import type { AppDb } from "../db/types";
import { formatSeriesNumber } from "../number-series";
import {
  krReferencePrefix,
  type BillingRunDetailRow, type BillingRunListRow, type BillingRunRepository,
} from "./billing-run-repository";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import { matterOrg } from "./matter-org";
import { inSeries, lockSeries, maxSeriesSeq } from "./series-sql";

export class DrizzleBillingRunRepository
  extends DrizzleRepository<BillingRun>
  implements BillingRunRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(billingRuns), now);
  }

  /** billing_runs saknar org-kolumn → härled via ärendet (#647). */
  protected override resolveOrg(row: unknown): Promise<string | undefined> {
    return matterOrg(this.db, (row as { matterId?: MatterId }).matterId);
  }

  /**
   * Registrera KR-referensen och skapa (#1379). Registret skrivs FÖRST: en
   * dubblett inom byrån bryter primärnyckeln innan någon körning finns.
   */
  override async create(data: Partial<BillingRun>): Promise<BillingRun> {
    const id = data.id ?? asId<"BillingRunId">(uuidv7());
    await this.registerReference(id, data.matterId, data.reference);
    return super.create({ ...data, id });
  }

  /** KR-referensen sätts bara när körningen skapas (#1379) — en uppdatering skriver aldrig över den. */
  override async update(id: BillingRunId, patch: Partial<BillingRun>): Promise<BillingRun> {
    const { reference: _r, ...rest } = patch;
    return super.update(id, rest);
  }

  private async registerReference(billingRunId: BillingRunId, matterId: MatterId | undefined, reference: string | null | undefined): Promise<void> {
    if (!reference) return;
    const organizationId = await matterOrg(this.db, matterId);
    if (!organizationId) return;
    await this.db.insert(krReferences).values({ organizationId, reference, billingRunId });
  }

  async nextKrReference(organizationId: OrganizationId, year: number): Promise<string> {
    const prefix = krReferencePrefix(year);
    // Ett nummer i taget per byrå och serie (#1379) — som fakturanumret (#1243).
    await lockSeries(this.db, `kr-reference:${organizationId}:${prefix}`);
    // Körningarna (även borttagna) och registret: en referens återanvänds aldrig.
    const [fromRuns] = await this.db
      .select({ seq: maxSeriesSeq(billingRuns.reference, prefix) }).from(billingRuns)
      .innerJoin(matters, eq(billingRuns.matterId, matters.id))
      .where(and(eq(matters.organizationId, organizationId), inSeries(billingRuns.reference, prefix)));
    const [fromRegister] = await this.db
      .select({ seq: maxSeriesSeq(krReferences.reference, prefix) }).from(krReferences)
      .where(and(eq(krReferences.organizationId, organizationId), inSeries(krReferences.reference, prefix)));
    return formatSeriesNumber(prefix, Math.max(Number(fromRuns?.seq ?? 0), Number(fromRegister?.seq ?? 0)) + 1);
  }

  async listForOrg(organizationId: OrganizationId, matterId?: MatterId): Promise<BillingRunListRow[]> {
    const rows = await this.db
      .select({
        run: billingRuns,
        invId: invoices.id, invNum: invoices.invoiceNumber, invStatus: invoices.status, invDate: invoices.invoiceDate,
      })
      .from(billingRuns)
      .innerJoin(matters, eq(billingRuns.matterId, matters.id))
      .leftJoin(invoices, eq(billingRuns.invoiceId, invoices.id))
      .where(and(
        eq(matters.organizationId, organizationId),
        matterId ? eq(billingRuns.matterId, matterId) : undefined,
        isNull(billingRuns.deletedAt),
      ))
      .orderBy(desc(billingRuns.createdAt));
    return rows.map((r): BillingRunListRow => ({
      ...r.run,
      invoice: r.invId && r.invStatus ? { id: r.invId, invoiceNumber: r.invNum, status: r.invStatus, invoiceDate: r.invDate } : null,
    }));
  }

  async getByIdInOrg(id: BillingRunId, organizationId: OrganizationId): Promise<BillingRunDetailRow | null> {
    const rows = await this.db
      .select({
        run: billingRuns,
        invId: invoices.id, invNum: invoices.invoiceNumber, invStatus: invoices.status, invAmount: invoices.amount,
        mId: matters.id, mNum: matters.matterNumber, mTitle: matters.title, mPay: matters.paymentMethod,
      })
      .from(billingRuns)
      .innerJoin(matters, eq(billingRuns.matterId, matters.id))
      .leftJoin(invoices, eq(billingRuns.invoiceId, invoices.id))
      .where(and(eq(billingRuns.id, id), eq(matters.organizationId, organizationId), isNull(billingRuns.deletedAt)))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r.run,
      invoice: r.invId && r.invStatus
        ? { id: r.invId, invoiceNumber: r.invNum, status: r.invStatus, amount: Number(r.invAmount ?? 0) }
        : null,
      matter: r.mId
        ? { id: r.mId, matterNumber: r.mNum, title: r.mTitle, paymentMethod: r.mPay ?? null }
        : null,
    };
  }

  async listAccontoSent(matterId: MatterId): Promise<BillingRun[]> {
    const rows = await this.db
      .select().from(billingRuns)
      .where(and(
        eq(billingRuns.matterId, matterId), eq(billingRuns.type, "ACCONTO"),
        eq(billingRuns.status, "SENT"), isNull(billingRuns.deletedAt),
      ));
    return rows;
  }

  async listAccontoByIds(matterId: MatterId, ids: BillingRunId[]): Promise<BillingRun[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select().from(billingRuns)
      .where(and(
        inArray(billingRuns.id, ids), eq(billingRuns.matterId, matterId),
        eq(billingRuns.type, "ACCONTO"), isNull(billingRuns.deletedAt),
      ));
    return rows;
  }
}
