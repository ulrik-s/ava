/**
 * Drizzle `PaymentPlanRepository` (ADR 0020) — server-impl. Ärver bas-CRUD från
 * `DrizzleRepository`; org-scopningen joinar plan→faktura→ärende (planer saknar
 * egen organizationId). Joinade läsningar använder Drizzles relationella
 * `with`-queries (org-filtret görs via id-prefiltrering, då `db.query` saknar
 * relations-where — samma mönster som invoice-repo:t). Påminnelserna grafas på
 * via en sekundär-query (undviker att duplicera den nästlade faktura-joinen).
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PaymentPlan, PaymentPlanReminder } from "@/lib/shared/schemas/billing";
import { asId } from "@/lib/shared/schemas/ids";
import { invoices, matters, paymentPlanReminders, paymentPlans } from "../db/schema";
import type { AppDb } from "../db/types";
import { DrizzleRepository, versionedTable } from "./drizzle-repository";
import type {
  JoinedPaymentPlan, JoinedPaymentPlanWithReminders, PaymentPlanRepository,
} from "./payment-plan-repository";

export class DrizzlePaymentPlanRepository extends DrizzleRepository<PaymentPlan> implements PaymentPlanRepository {
  constructor(db: AppDb, now: () => Date = () => new Date()) {
    super(db, versionedTable(paymentPlans), now);
  }

  async getByIdInOrg(planId: string, organizationId: string): Promise<PaymentPlan | null> {
    const rows = await this.db
      .select({ plan: paymentPlans }).from(paymentPlans)
      .innerJoin(invoices, eq(paymentPlans.invoiceId, invoices.id))
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(paymentPlans.id, planId),
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        isNull(paymentPlans.deletedAt),
      )).limit(1);
    return this.asRow(rows[0]?.plan);
  }

  async getByInvoiceId(invoiceId: string): Promise<PaymentPlan | null> {
    const rows = await this.db
      .select().from(paymentPlans)
      .where(and(eq(paymentPlans.invoiceId, invoiceId), isNull(paymentPlans.deletedAt))).limit(1);
    return this.asRow(rows[0]);
  }

  /** Plan-id:n i org:en (via faktura→ärende), valfritt status-filtrerade. */
  private async planIdsInOrg(organizationId: string, status?: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: paymentPlans.id }).from(paymentPlans)
      .innerJoin(invoices, eq(paymentPlans.invoiceId, invoices.id))
      .innerJoin(matters, eq(invoices.matterId, matters.id))
      .where(and(
        eq(matters.organizationId, asId<"OrganizationId">(organizationId)),
        status ? eq(paymentPlans.status, status) : undefined,
        isNull(paymentPlans.deletedAt),
      ));
    return rows.map((r) => r.id as string);
  }

  /** Hämta joinade planer (faktura + ärende inkl. KLIENT + betalningar + avskrivningar). */
  private async fetchJoined(ids: string[]): Promise<JoinedPaymentPlan[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query.paymentPlans.findMany({
      where: inArray(paymentPlans.id, ids),
      orderBy: (pp, { desc: d }) => [d(pp.createdAt)],
      with: {
        invoice: {
          with: {
            matter: {
              with: {
                contacts: { where: (mc, { eq: e }) => e(mc.role, "KLIENT"), limit: 1, with: { contact: true } },
              },
            },
            payments: { orderBy: (p, { desc: d }) => [d(p.paidAt)] },
            writeOffs: true,
          },
        },
      },
    });
    return rows as unknown as JoinedPaymentPlan[];
  }

  /** Påminnelser per plan (sentAt desc), grupperade. */
  private async remindersByPlan(ids: string[]): Promise<Map<string, PaymentPlanReminder[]>> {
    const out = new Map<string, PaymentPlanReminder[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select().from(paymentPlanReminders)
      .where(inArray(paymentPlanReminders.planId, ids.map((id) => asId<"PaymentPlanId">(id))))
      .orderBy(desc(paymentPlanReminders.sentAt));
    for (const r of rows) {
      (out.get(r.planId) ?? out.set(r.planId, []).get(r.planId)!).push(r);
    }
    return out;
  }

  async listForOrg(organizationId: string, status?: string): Promise<JoinedPaymentPlan[]> {
    return this.fetchJoined(await this.planIdsInOrg(organizationId, status));
  }

  async getByIdWithDetails(id: string, organizationId: string): Promise<JoinedPaymentPlanWithReminders | null> {
    if (!(await this.getByIdInOrg(id, organizationId))) return null;
    const [plan] = await this.fetchJoined([id]);
    if (!plan) return null;
    const reminders = (await this.remindersByPlan([id])).get(id) ?? [];
    return { ...plan, reminders };
  }

  async listActiveForScan(organizationId: string): Promise<JoinedPaymentPlanWithReminders[]> {
    const ids = await this.planIdsInOrg(organizationId, "ACTIVE");
    const plans = await this.fetchJoined(ids);
    const byPlan = await this.remindersByPlan(ids);
    return plans.map((p) => ({ ...p, reminders: byPlan.get(p.id) ?? [] }));
  }
}
