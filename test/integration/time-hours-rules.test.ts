/**
 * Tillåtna tidsvärden (#1544) genom routrarna: nya och ändrade poster måste
 * ligga på 6-minuters-/kvartsrutnätet, men lagrade äldre poster (37 min, en
 * standardåtgärd på 20 min) läses och listas som förut (ADR 0004).
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { TIME_NOT_ALLOWED_MESSAGE } from "@/lib/shared/time-hours";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const LEGACY = asId<"TimeEntryId">("te-legacy");
const ATGARD = {
  id: "brev", description: "Brev till klient", kind: "ARBETE" as const, stage: "ANY" as const, paymentMethods: [], billable: true, active: true,
};

function setup() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X", standardAtgarder: [{ ...ATGARD, minutes: 20 }] }],
    matters: [{ id: MATTER, organizationId: "org-1", matterNumber: "2026-0001", title: "Ärende", status: "ACTIVE", paymentMethod: "PRIVAT", createdAt: new Date() }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    timeEntries: [{
      id: LEGACY, organizationId: "org-1", userId: "u-1", matterId: MATTER, date: new Date("2026-09-20T10:00:00.000Z"),
      minutes: 37, description: "Äldre post", hourlyRate: 250_000, billable: true, kind: "ARBETE",
    }],
    expenses: [],
  }, async () => { /* skrivbar */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

const entry = (minutes: number) => ({ matterId: MATTER, date: "2026-09-21", minutes, description: "Arbete" });

describe("tillåtna tidsvärden i routrarna (#1544)", () => {
  it("en lagrad post med 37 minuter läses och listas utan fel", async () => {
    const { entries, totalMinutes } = await setup().timeEntry.list({ matterId: MATTER });
    expect(entries.map((e) => e.minutes)).toEqual([37]);
    expect(totalMinutes).toBe(37);
  });

  it("timeEntry.create: 37 minuter avvisas med meddelandet, 36 accepteras", async () => {
    const caller = setup();
    await expect(caller.timeEntry.create(entry(37))).rejects.toThrow(TIME_NOT_ALLOWED_MESSAGE);
    expect((await caller.timeEntry.create(entry(36))).minutes).toBe(36);
  });

  it("timeEntry.create: per-dygnspost med 0 minuter accepteras som förut", async () => {
    const created = await setup().timeEntry.create({ ...entry(0), kind: "ADVOKATBEREDSKAP" });
    expect(created.minutes).toBe(0);
  });

  it("timeEntry.update: 37 minuter avvisas, 36 accepteras", async () => {
    const caller = setup();
    await expect(caller.timeEntry.update({ id: LEGACY, minutes: 37 })).rejects.toThrow(TIME_NOT_ALLOWED_MESSAGE);
    expect((await caller.timeEntry.update({ id: LEGACY, minutes: 36 })).minutes).toBe(36);
  });

  it("mail.saveIncoming: tidspost på otillåtet värde avvisas", async () => {
    await expect(setup().mail.saveIncoming({
      matterId: MATTER, emlBase64: Buffer.from("Subject: Hej\r\n\r\nKropp").toString("base64"),
      subject: "Hej", receivedAt: "2026-09-21T08:00:00Z", time: { minutes: 5 },
    })).rejects.toThrow(TIME_NOT_ALLOWED_MESSAGE);
  });

  it("byrån med en sparad standardåtgärd på 20 minuter läses som förut", async () => {
    const settings = await setup().organization.getSettings();
    expect(settings.standardAtgarder).toEqual([expect.objectContaining({ id: "brev", minutes: 20 })]);
  });

  it("standardåtgärd med otillåten tid avvisas och felet namnger åtgärden", async () => {
    const caller = setup();
    const save = (minutes: number) => caller.organization.updateSettings({ standardAtgarder: [{ ...ATGARD, minutes }] });
    await expect(save(20)).rejects.toThrow(/Standardåtgärden ”Brev till klient”/);
    await save(18);
    expect((await caller.organization.getSettings()).standardAtgarder).toEqual([expect.objectContaining({ minutes: 18 })]);
  });
});
