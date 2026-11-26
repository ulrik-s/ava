/**
 * Kostnadsräkningens KÖRNING i förordnandemål (#1857, ADR 0034).
 *
 * Med dialogens `forordnande` räknar servern yrkandet på förordnandetaxan och
 * ärendets förhör (tidsposterna med kategorin FORHOR), med samma funktion och
 * samma förhör som dokumentet. Avslutet sparas i körningens anteckning, och
 * ärendet ändras inte. Utan fältet beter sig körningen som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { forhorFromTimeEntries } from "@/lib/shared/billing/forordnandetaxa";
import { kostnadsrakningClaimInclVat } from "@/lib/shared/billing/kostnadsrakning";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
/** Två förhör en tisdag förmiddag (svensk tid) och en arbetspost. */
const ENTRIES = [
  { id: "te-f1", date: "2026-09-22T07:00:00.000Z", minutes: 40, kind: "FORHOR" },
  { id: "te-f2", date: "2026-09-22T09:00:00.000Z", minutes: 30, kind: "FORHOR" },
  { id: "te-a", date: "2026-09-21T09:00:00.000Z", minutes: 300, kind: "ARBETE" },
] as const;

function setup(paymentMethod = "OFFENTLIGT_UPPDRAG") {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: MATTER, organizationId: "org-1", matterNumber: "2026-0020", title: "Förordnandemål", status: "ACTIVE",
      paymentMethod, isTaxeArende: false, createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    timeEntries: ENTRIES.map((e) => ({
      id: e.id, organizationId: "org-1", userId: "u-1", matterId: MATTER, date: new Date(e.date),
      minutes: e.minutes, description: "Post", hourlyRate: 250_000, billable: true, kind: e.kind,
    })),
    expenses: [],
  }, async () => { /* writable */ });
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
  return { caller };
}

/** Dokumentets yrkande för samma poster och samma avslut. */
function documentClaim(yrkandeDate: Date): number {
  const timeEntries = ENTRIES.map((e) => ({ id: e.id, date: new Date(e.date), minutes: e.minutes, description: "Post", hourlyRate: 250_000, billable: true, kind: e.kind }));
  return kostnadsrakningClaimInclVat({
    forordnande: { forhor: forhorFromTimeEntries(timeEntries), avslut: "NEDLAGD" },
    yrkandeDate, hasFTax: true, isTaxeArende: true, timeEntries, expenses: [],
  });
}

describe("createKostnadsrakning — förordnandemål (#1857)", () => {
  it("yrkar förordnandetaxan med ärendets förhör, samma belopp som dokumentet", async () => {
    const { caller } = setup();
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, forordnande: { avslut: "NEDLAGD" } });
    expect(run.workValueOreAtRun).toBe(documentClaim(new Date(run.periodTo ?? Date.now())));
    expect(run.amountOre).toBe(run.workValueOreAtRun);
  });

  it("avslutet sparas i anteckningen, och ärendet ändras inte", async () => {
    const { caller } = setup();
    const before = await caller.matter.getById({ id: MATTER });
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, forordnande: { avslut: "INGET_ATAL" }, isTaxeArende: true });
    expect(run.notes).toBe("Förordnandetaxa – förundersökningen avslutades utan åtal");
    const after = await caller.matter.getById({ id: MATTER });
    const taxeFields = (m: typeof before) => [m.isTaxeArende, m.taxaLevel, m.taxaHuvudforhandlingMin, m.taxaHufStart];
    expect(taxeFields(after)).toEqual(taxeFields(before));
  });

  it("utan förordnande: som förut (löpande räkning), ingen anteckning om avslutet", async () => {
    const { caller } = setup();
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, notes: "Egen" });
    expect(run.notes).toBe("Egen");
    expect(run.workValueOreAtRun).not.toBe(documentClaim(new Date(run.periodTo ?? Date.now())));
  });

  it("inte offentligt uppdrag → PRECONDITION_FAILED", async () => {
    const { caller } = setup("RATTSHJALP");
    await expect(caller.billingRun.createKostnadsrakning({ matterId: MATTER, forordnande: { avslut: "NEDLAGD" } }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("ett okänt avslut vägras av schemat", async () => {
    const { caller } = setup();
    await expect(caller.billingRun.createKostnadsrakning({ matterId: MATTER, forordnande: { avslut: "OKAND" as never } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
