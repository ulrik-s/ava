/**
 * Synkläget per enhet i Postgres (#1267) — pglite.
 *
 * Det som skyddas: varje rapport skriver över enhetens förra, en enhet i en
 * annan byrå skrivs aldrig över eller glöms, och listan visar senast sedda först.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { DrizzleSyncDevices } from "@/lib/server/sync/drizzle-sync-devices";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const OTHER = uuidv7();
const USER = uuidv7();

describe("DrizzleSyncDevices (#1267)", () => {
  let handle: TestDbHandle;
  let clock = Date.UTC(2026, 8, 30, 8, 0);
  let devices: DrizzleSyncDevices;

  beforeAll(async () => {
    handle = await createTestDb();
    devices = new DrizzleSyncDevices(handle.db, () => new Date(clock));
  });
  afterAll(async () => { await handle.close(); });

  it("en rapport sparas med serverns tid; nästa skriver över den", async () => {
    const deviceId = uuidv7();
    await devices.report(ORG, USER, { deviceId, label: "Chrome på macOS", pendingCount: 3, oldestPendingAt: clock - 60_000 });
    clock += 1000;
    await devices.report(ORG, USER, { deviceId, label: "Chrome på macOS", pendingCount: 0, oldestPendingAt: null });
    const [row] = (await devices.list(ORG)).filter((d) => d.deviceId === deviceId);
    expect(row).toEqual({ deviceId, userId: USER, label: "Chrome på macOS", pendingCount: 0, oldestPendingAt: null, lastSeenAt: clock });
  });

  it("den äldsta osynkade ändringen följer med", async () => {
    const deviceId = uuidv7();
    const oldest = clock - 25 * 3600_000;
    await devices.report(ORG, USER, { deviceId, label: null, pendingCount: 1, oldestPendingAt: oldest });
    expect((await devices.list(ORG)).find((d) => d.deviceId === deviceId)).toMatchObject({ pendingCount: 1, oldestPendingAt: oldest });
  });

  it("en enhet i en annan byrå skrivs inte över, syns inte och glöms inte", async () => {
    const deviceId = uuidv7();
    await devices.report(OTHER, USER, { deviceId, label: "Annan byrå", pendingCount: 5, oldestPendingAt: null });
    await devices.report(ORG, USER, { deviceId, label: "Kapad", pendingCount: 0, oldestPendingAt: null });
    expect((await devices.list(ORG)).some((d) => d.deviceId === deviceId)).toBe(false);
    await devices.forget(ORG, deviceId);
    expect(await devices.list(OTHER)).toEqual([expect.objectContaining({ deviceId, label: "Annan byrå", pendingCount: 5 })]);
  });

  it("listan visar senast sedda först; glömd enhet försvinner", async () => {
    const early = uuidv7(), late = uuidv7();
    const org = uuidv7();
    await devices.report(org, USER, { deviceId: early, label: null, pendingCount: 0, oldestPendingAt: null });
    clock += 5000;
    await devices.report(org, USER, { deviceId: late, label: null, pendingCount: 0, oldestPendingAt: null });
    expect((await devices.list(org)).map((d) => d.deviceId)).toEqual([late, early]);
    await devices.forget(org, late);
    expect((await devices.list(org)).map((d) => d.deviceId)).toEqual([early]);
  });

  it("standardklockan är nu", async () => {
    const real = new DrizzleSyncDevices(handle.db);
    const org = uuidv7(), deviceId = uuidv7();
    const before = Date.now();
    await real.report(org, USER, { deviceId, label: null, pendingCount: 0, oldestPendingAt: null });
    expect((await real.list(org))[0]?.lastSeenAt).toBeGreaterThanOrEqual(before - 1000);
  });
});
