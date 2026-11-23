/**
 * En låsregel för tidsposter och utlägg genom faktureringsvägarna (#1862).
 *
 * Förut valde per-post-vägen (`billingRun.createFinal` med `timeEntryIds`/
 * `expenseIds`) bara på `invoiceId`: en post som kostnadsräkningen redan frös
 * kunde faktureras klienten en gång till. Och standardvägen tog en post som
 * bara hade `invoiceId`. Nu väljer båda repona ur `BILLING_LOCK_FIELDS`.
 *
 * Körs mot en riktig in-memory-store genom hela routern, så repo-reglerna är med.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const REJECTED = { code: "BAD_REQUEST", message: "Någon vald post är redan fakturerad eller tillhör annat ärende." };

/** Offentligt uppdrag (löpande räkning) med en tidspost och ett utlägg; `billedOnly` har bara `invoiceId`. */
function setup() {
  const base = { organizationId: "org-1", userId: "u-1", matterId: MATTER, date: new Date("2026-09-20T10:00:00.000Z"), billable: true };
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: MATTER, organizationId: "org-1", matterNumber: "2026-0042", title: "Uppdrag", status: "ACTIVE",
      paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: false, createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    invoices: [{ id: "inv-old", matterId: MATTER, amount: 100_000, invoiceDate: new Date("2026-09-01"), status: "SENT", invoiceType: "STANDARD" }],
    timeEntries: [
      { ...base, id: "te-1", minutes: 120, description: "Arbete", hourlyRate: 250_000, kind: "ARBETE" },
      { ...base, id: "te-billed", minutes: 60, description: "Fakturerad", hourlyRate: 250_000, kind: "ARBETE", invoiceId: "inv-old" },
    ],
    expenses: [
      { ...base, id: "ex-1", amount: 50_000, description: "Resa" },
      { ...base, id: "ex-billed", amount: 30_000, description: "Fakturerad resa", invoiceId: "inv-old" },
    ],
  }, async () => { /* writable: noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

describe("createFinal per post vägrar låsta poster (#1862)", () => {
  it("en tidspost som kostnadsräkningen frös → BAD_REQUEST", async () => {
    const caller = setup();
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    await expect(caller.billingRun.createFinal({ matterId: MATTER, recipient: "KLIENT", timeEntryIds: [asId("te-1")] }))
      .rejects.toMatchObject(REJECTED);
  });

  it("ett utlägg som kostnadsräkningen frös → BAD_REQUEST", async () => {
    const caller = setup();
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    await expect(caller.billingRun.createFinal({ matterId: MATTER, recipient: "KLIENT", expenseIds: [asId("ex-1")] }))
      .rejects.toMatchObject(REJECTED);
  });

  it("en post med bara en faktura → BAD_REQUEST, för tid och utlägg", async () => {
    const caller = setup();
    await expect(caller.billingRun.createFinal({ matterId: MATTER, recipient: "KLIENT", timeEntryIds: [asId("te-billed")] }))
      .rejects.toMatchObject(REJECTED);
    await expect(caller.billingRun.createFinal({ matterId: MATTER, recipient: "KLIENT", expenseIds: [asId("ex-billed")] }))
      .rejects.toMatchObject(REJECTED);
  });
});

describe("standardvägarna tar inte en post med bara en faktura (#1862)", () => {
  it("förslaget och kostnadsräkningen visar bara de olåsta posterna", async () => {
    const caller = setup();
    const proposal = await caller.billingRun.proposal({ matterId: MATTER });
    expect(proposal.timeEntries.map((t) => t.id)).toEqual(["te-1"]);
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    const after = await caller.billingRun.proposal({ matterId: MATTER });
    expect(after.timeEntries).toEqual([]);
  });

  it("createFinal utan val fryser bara de olåsta posterna", async () => {
    const caller = setup();
    const { run } = await caller.billingRun.createFinal({ matterId: MATTER, recipient: "KLIENT" });
    const entries = (await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 })).entries;
    const frozenBy = Object.fromEntries(entries.map((t) => [t.id, t.frozenByBillingRunId ?? null]));
    expect(frozenBy).toEqual({ "te-1": run.id, "te-billed": null });
  });
});
