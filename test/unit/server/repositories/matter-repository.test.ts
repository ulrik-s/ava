/**
 * MatterRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot båda
 * impls: in-memory (LocalStore) och Drizzle (pglite). Bas-CRUD (ärvd) + den
 * direkta org-scopningen (`getByIdInOrg`, ärenden bär organizationId själva).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters } from "@/lib/server/db/schema";
import { DrizzleMatterRepository } from "@/lib/server/repositories/drizzle-matter-repository";
import { InMemoryMatterRepository } from "@/lib/server/repositories/in-memory-matter-repository";
import type { MatterRepository } from "@/lib/server/repositories/matter-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const matterId = uuidv7();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const matter = (o: Record<string, unknown> = {}): any => ({
  id: matterId, organizationId: "org-1", matterNumber: "2026-0001", title: "Test", status: "ACTIVE", ...o,
});

async function assertContract(repo: MatterRepository): Promise<void> {
  const created = await repo.create(matter());
  expect(created.matterNumber).toBe("2026-0001");
  expect((created as { version?: number }).version).toBe(1);

  expect(await repo.getById(matterId)).toMatchObject({ id: matterId });
  expect(await repo.getById(uuidv7())).toBeNull();

  const updated = await repo.update(matterId, { title: "Ny titel" });
  expect(updated.title).toBe("Ny titel");
  expect((updated as { version?: number }).version).toBe(2);

  await repo.softDelete(matterId);
  expect(await repo.getById(matterId)).toBeNull();
}

describe("MatterRepository — in-memory", () => {
  it("uppfyller kontraktet", async () => {
    const store = new LocalStore({ matters: [] }, async () => {});
    await assertContract(new InMemoryMatterRepository(store));
  });

  it("getByIdInOrg org-scopar direkt på organizationId", async () => {
    const store = new LocalStore({ matters: [matter({ id: matterId, organizationId: "org-1" })] }, async () => {});
    const repo = new InMemoryMatterRepository(store);
    expect(await repo.getByIdInOrg(matterId, "org-1")).toMatchObject({ id: matterId });
    expect(await repo.getByIdInOrg(matterId, "org-2")).toBeNull(); // fel org
  });
});

describe("MatterRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("uppfyller kontraktet", async () => {
    const org = uuidv7();
    const repo = new DrizzleMatterRepository(handle.db);
    // org-kolumnen är uuid → kontraktets create() måste ha giltig UUID-org.
    const id = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await repo.create({ id, organizationId: org, matterNumber: "2026-9", title: "T" } as any);
    expect((created as { version?: number }).version).toBe(1);
    const updated = await repo.update(id, { title: "Ny" });
    expect((updated as { version?: number }).version).toBe(2);
    await repo.softDelete(id);
    expect(await repo.getById(id)).toBeNull();
  });

  it("getByIdInOrg org-scopar direkt på organizationId", async () => {
    const db = handle.db;
    const org = uuidv7();
    const id = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(matters).values({ id, organizationId: org, matterNumber: "2026-2", title: "T", version: 1 } as any);
    const repo = new DrizzleMatterRepository(handle.db);
    expect(await repo.getByIdInOrg(id, org)).toMatchObject({ id });
    expect(await repo.getByIdInOrg(id, uuidv7())).toBeNull(); // fel org
  });
});
