/**
 * UserRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle (pglite).
 * `getByIdInOrg` + `listByOrg` (org-scope direkt på organizationId).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { users } from "@/lib/server/db/schema";
import { DrizzleUserRepository } from "@/lib/server/repositories/drizzle-user-repository";
import { InMemoryUserRepository } from "@/lib/server/repositories/in-memory-user-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("UserRepository — in-memory", () => {
  it("getByIdInOrg + listByOrg org-scopar", async () => {
    const u1 = uuidv7();
    const u2 = uuidv7();
    const store = new LocalStore({
      users: [
        { id: u1, organizationId: "org-1", email: "a@x", name: "Beta" },
        { id: u2, organizationId: "org-1", email: "b@x", name: "Alfa" },
        { id: uuidv7(), organizationId: "org-2", email: "c@x", name: "Gamma" },
      ],
    }, async () => {});
    const repo = new InMemoryUserRepository(store);
    expect(await repo.getByIdInOrg(u1, "org-1")).toMatchObject({ id: u1 });
    expect(await repo.getByIdInOrg(u1, "org-2")).toBeNull(); // fel org
    const list = await repo.listByOrg("org-1");
    expect(list).toHaveLength(2);
    expect(list.map((u) => u.name)).toEqual(["Alfa", "Beta"]); // namn-sorterat
  });
});

describe("UserRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("getByIdInOrg + listByOrg org-scopar (namn asc)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const u1 = uuidv7();
    const u2 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(users).values(v({ id: u1, organizationId: org, email: "a@x", name: "Beta" }));
    await db.insert(users).values(v({ id: u2, organizationId: org, email: "b@x", name: "Alfa" }));
    await db.insert(users).values(v({ id: uuidv7(), organizationId: uuidv7(), email: "c@x", name: "Gamma" }));
    const repo = new DrizzleUserRepository(handle.db);
    expect(await repo.getByIdInOrg(u1, org)).toMatchObject({ id: u1 });
    expect(await repo.getByIdInOrg(u1, uuidv7())).toBeNull();
    const list = await repo.listByOrg(org);
    expect(list).toHaveLength(2);
    expect(list.map((u) => u.name)).toEqual(["Alfa", "Beta"]);
  });
});
