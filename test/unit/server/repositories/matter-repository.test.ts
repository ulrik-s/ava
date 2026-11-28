/**
 * MatterRepository-paritet (ADR 0020, #409 fan-out) — SAMMA kontrakt mot båda
 * impls: in-memory (LocalStore) och Drizzle (pglite). Bas-CRUD (ärvd) + den
 * direkta org-scopningen (`getByIdInOrg`, ärenden bär organizationId själva).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { DrizzleMatterRepository } from "@/lib/server/repositories/drizzle-matter-repository";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { InMemoryMatterRepository } from "@/lib/server/repositories/in-memory-matter-repository";
import type { MatterRepository } from "@/lib/server/repositories/matter-repository";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const matterId = asId<"MatterId">(uuidv7());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const matter = (o: Record<string, unknown> = {}): any => ({
  id: matterId, organizationId: "org-1", matterNumber: "2026-0001", title: "Test", status: "ACTIVE", ...o,
});

async function assertContract(repo: MatterRepository): Promise<void> {
  const created = await repo.create(matter());
  expect(created.matterNumber).toBe("2026-0001");
  expect((created as { version?: number }).version).toBe(1);

  expect(await repo.getById(asId<"MatterId">(matterId))).toMatchObject({ id: matterId });
  expect(await repo.getById(asId<"MatterId">(uuidv7()))).toBeNull();

  const updated = await repo.update(asId<"MatterId">(matterId), { title: "Ny titel" });
  expect(updated.title).toBe("Ny titel");
  expect((updated as { version?: number }).version).toBe(2);

  await repo.softDelete(asId<"MatterId">(matterId));
  expect(await repo.getById(asId<"MatterId">(matterId))).toBeNull();
}

describe("MatterRepository — in-memory", () => {
  it("uppfyller kontraktet", async () => {
    const store = new LocalStore({ matters: [] }, async () => {});
    await assertContract(new InMemoryMatterRepository(store));
  });

  it("getByIdInOrg org-scopar direkt på organizationId", async () => {
    const store = new LocalStore({ matters: [matter({ id: matterId, organizationId: "org-1" })] }, async () => {});
    const repo = new InMemoryMatterRepository(store);
    expect(await repo.getByIdInOrg(matterId, asId<"OrganizationId">("org-1"))).toMatchObject({ id: matterId });
    expect(await repo.getByIdInOrg(matterId, asId<"OrganizationId">("org-2"))).toBeNull(); // fel org
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
    const updated = await repo.update(asId<"MatterId">(id), { title: "Ny" });
    expect((updated as { version?: number }).version).toBe(2);
    await repo.softDelete(asId<"MatterId">(id));
    expect(await repo.getById(asId<"MatterId">(id))).toBeNull();
  });

  it("getByIdInOrg org-scopar direkt på organizationId", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const id = asId<"MatterId">(uuidv7());
    await db.insert(matters).values({ id, organizationId: org, matterNumber: "2026-2", title: "T", version: 1 });
    const repo = new DrizzleMatterRepository(handle.db);
    expect(await repo.getByIdInOrg(id, org)).toMatchObject({ id });
    expect(await repo.getByIdInOrg(id, asId<"OrganizationId">(uuidv7()))).toBeNull(); // fel org
  });

  it("matter.create utan taxeflaggorna läses tillbaka med kolumnernas standardvärden (#1919)", async () => {
    const org = asId<"OrganizationId">(uuidv7());
    const user = asId<"UserId">(uuidv7());
    await handle.db.insert(users).values({ id: user, organizationId: org, email: "a@b.se", name: "A", role: "LAWYER", active: true, version: 1 });
    const repos = buildDrizzleRepositories(handle.db);
    const caller = appRouter.createCaller(buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: user, email: "a@b.se", name: "A", role: "LAWYER", organizationId: org },
    }));
    const created = await caller.matter.create({ title: "Utan flaggor" });
    expect(await repos.matters.getById(asId<"MatterId">(created.id))).toMatchObject({ isTaxeArende: false, taxaHasFTax: true });
  });
});
