/**
 * `buildDrizzleRepositories` (ADR 0020 / #409) — kontraktstest mot pglite.
 * Verifierar att aggregatet wirar alla entiteter + att `transaction` ger en
 * riktig SQL-transaktion (commit vid success, rollback vid kast, reentrant nästling).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Organization } from "@/lib/shared/schemas/organization";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG_KEYS = [
  "invoices", "matters", "payments", "writeOffs", "paymentPlans", "paymentPlanReminders",
  "timeEntries", "expenses", "accontoDeductions", "billingRuns", "contacts", "matterContacts",
  "conflictChecks", "users", "tasks", "calendarEvents", "serviceNotes", "documents",
  "documentFolders", "matterEventSuggestions", "documentAnalysisSuggestions", "documentTemplates",
  "expectedReceivables", "invoiceDispatches", "organizations", "offices", "userPreferences", "orgPreferences",
] as const;

const org = (id: string, name = "X") => ({ id, name }) as unknown as Partial<Organization>;

describe("buildDrizzleRepositories — kontrakt (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("wirar alla 28 entitets-repos + transaction", () => {
    const repos = buildDrizzleRepositories(handle.db);
    for (const k of ORG_KEYS) {
      expect(repos[k], `saknar repo: ${k}`).toBeDefined();
      expect(typeof (repos[k] as { getById?: unknown }).getById).toBe("function");
    }
    expect(typeof repos.transaction).toBe("function");
  });

  it("bas-CRUD round-trippar via aggregatet (create → getById)", async () => {
    const repos = buildDrizzleRepositories(handle.db);
    const id = uuidv7();
    const created = await repos.organizations.create(org(id, "Aggregat AB"));
    expect((created as { version?: number }).version).toBe(1);
    expect(await repos.organizations.getById(id)).toMatchObject({ id, name: "Aggregat AB" });
  });

  it("create utan id → genererar ett uuid (server-genererad create, #630)", async () => {
    const repos = buildDrizzleRepositories(handle.db);
    const orgId = uuidv7();
    await repos.organizations.create(org(orgId));
    // Ingen `id` → repo:t ska generera ett uuidv7 (uuid-PK har inget DB-default).
    const created = await repos.contacts.create({ organizationId: orgId, name: "Utan id", contactType: "PERSON" } as never);
    const id = (created as { id?: string }).id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await repos.contacts.getById(id!)).toMatchObject({ name: "Utan id" });
  });

  it("transaction committar vid success", async () => {
    const repos = buildDrizzleRepositories(handle.db);
    const id = uuidv7();
    await repos.transaction(async (tx) => { await tx.organizations.create(org(id)); });
    expect(await repos.organizations.getById(id)).toMatchObject({ id });
  });

  it("transaction rullar tillbaka vid kast (inget delvis committat)", async () => {
    const repos = buildDrizzleRepositories(handle.db);
    const id = uuidv7();
    await expect(
      repos.transaction(async (tx) => {
        await tx.organizations.create(org(id));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await repos.organizations.getById(id)).toBeNull();
  });

  it("nästlad transaction är reentrant (delar samma tx → committar tillsammans)", async () => {
    const repos = buildDrizzleRepositories(handle.db);
    const a = uuidv7();
    const b = uuidv7();
    await repos.transaction(async (tx) => {
      await tx.organizations.create(org(a, "Yttre"));
      await tx.transaction(async (inner) => { await inner.organizations.create(org(b, "Inre")); });
    });
    expect(await repos.organizations.getById(a)).toMatchObject({ id: a });
    expect(await repos.organizations.getById(b)).toMatchObject({ id: b });
  });
});
