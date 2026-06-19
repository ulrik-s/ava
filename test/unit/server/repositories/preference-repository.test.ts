/**
 * User/Org-PreferenceRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { orgPreferences, userPreferences } from "@/lib/server/db/schema";
import { DrizzleOrgPreferenceRepository } from "@/lib/server/repositories/drizzle-org-preference-repository";
import { DrizzleUserPreferenceRepository } from "@/lib/server/repositories/drizzle-user-preference-repository";
import { InMemoryOrgPreferenceRepository } from "@/lib/server/repositories/in-memory-org-preference-repository";
import { InMemoryUserPreferenceRepository } from "@/lib/server/repositories/in-memory-user-preference-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("Preference repos — in-memory", () => {
  it("getByUserKey + getByOrgKey + listByOrg", async () => {
    const userId = uuidv7();
    const up = uuidv7();
    const op = uuidv7();
    const store = new LocalStore({
      userPreferences: [{ id: up, userId, organizationId: "org-1", key: "list.contacts", prefs: { sort: "name" } }],
      orgPreferences: [{ id: op, organizationId: "org-1", key: "list.contacts", prefs: { sort: "createdAt" } }],
    }, async () => {});
    const uRepo = new InMemoryUserPreferenceRepository(store);
    const oRepo = new InMemoryOrgPreferenceRepository(store);
    expect((await uRepo.getByUserKey(userId, "org-1", "list.contacts"))?.id).toBe(up);
    expect(await uRepo.getByUserKey(userId, "org-1", "list.x")).toBeNull();
    expect((await oRepo.getByOrgKey("org-1", "list.contacts"))?.id).toBe(op);
    expect(await oRepo.listByOrg("org-1")).toHaveLength(1);
  });
});

describe("Preference repos — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("getByUserKey + getByOrgKey + listByOrg", async () => {
    const db = handle.db;
    const org = uuidv7();
    const userId = uuidv7();
    const up = uuidv7();
    const op = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(userPreferences).values(v({ id: up, userId, organizationId: org, key: "list.contacts", prefs: { sort: "name" } }));
    await db.insert(orgPreferences).values(v({ id: op, organizationId: org, key: "list.contacts", prefs: { sort: "createdAt" } }));
    const uRepo = new DrizzleUserPreferenceRepository(handle.db);
    const oRepo = new DrizzleOrgPreferenceRepository(handle.db);
    expect((await uRepo.getByUserKey(userId, org, "list.contacts"))?.id).toBe(up);
    expect(await uRepo.getByUserKey(userId, org, "list.x")).toBeNull();
    expect((await oRepo.getByOrgKey(org, "list.contacts"))?.id).toBe(op);
    expect(await oRepo.listByOrg(org)).toHaveLength(1);
  });
});
