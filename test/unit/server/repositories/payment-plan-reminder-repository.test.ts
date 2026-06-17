/**
 * PaymentPlanReminderRepository-paritet (ADR 0020) — bas-CRUD (create/getById)
 * mot in-memory (LocalStore) + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { paymentPlanReminders } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzlePaymentPlanReminderRepository } from "@/lib/server/repositories/drizzle-payment-plan-reminder-repository";
import { InMemoryPaymentPlanReminderRepository } from "@/lib/server/repositories/in-memory-payment-plan-reminder-repository";
import type { PaymentPlanReminderRepository } from "@/lib/server/repositories/payment-plan-reminder-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

async function assertContract(repo: PaymentPlanReminderRepository): Promise<void> {
  const id = uuidv7();
  const created = await repo.create({
    id, planId: uuidv7(), dueMonth: "2026-06", type: "DUE", sentAt: new Date("2026-06-15"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  expect(created.dueMonth).toBe("2026-06");
  expect((created as { version?: number }).version).toBe(1);
  expect(await repo.getById(id)).toMatchObject({ id, type: "DUE" });
}

describe("PaymentPlanReminderRepository — in-memory", () => {
  it("uppfyller bas-kontraktet", async () => {
    const store = new LocalStore({ paymentPlanReminders: [] }, async () => {});
    await assertContract(new InMemoryPaymentPlanReminderRepository(store));
  });
});

describe("PaymentPlanReminderRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("uppfyller bas-kontraktet", async () => {
    await assertContract(new DrizzlePaymentPlanReminderRepository(handle.db as unknown as AppDb));
    // referera tabellen så schema-importen inte är oanvänd
    expect(paymentPlanReminders).toBeDefined();
  });
});
