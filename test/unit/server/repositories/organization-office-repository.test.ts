/**
 * Organization/Office-repo-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { offices, organizations } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleOfficeRepository } from "@/lib/server/repositories/drizzle-office-repository";
import { DrizzleOrganizationRepository } from "@/lib/server/repositories/drizzle-organization-repository";
import { InMemoryOfficeRepository } from "@/lib/server/repositories/in-memory-office-repository";
import { InMemoryOrganizationRepository } from "@/lib/server/repositories/in-memory-organization-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("Organization/Office — in-memory", () => {
  it("org getById/update; offices listByOrg (main först) + getByIdInOrg + demoteMains", async () => {
    const org = "org-1";
    const main = uuidv7();
    const branch = uuidv7();
    const store = new LocalStore({
      organizations: [{ id: org, name: "Byrå AB" }],
      offices: [
        { id: main, organizationId: org, name: "Sthlm", isMain: true },
        { id: branch, organizationId: org, name: "Gbg", isMain: false },
      ],
    }, async () => {});
    const orgRepo = new InMemoryOrganizationRepository(store);
    expect(await orgRepo.getById(org)).toMatchObject({ id: org });
    const offRepo = new InMemoryOfficeRepository(store);
    const list = await offRepo.listByOrg(org);
    // In-memory query-engine sorterar inte boolean isMain desc (routern litar på
    // att orderBy skickas; Drizzle/SQL-vägen ordnar). Verifiera medlemskap här.
    expect(list.map((o) => o.id).sort()).toEqual([main, branch].sort());
    expect(await offRepo.getByIdInOrg(branch, org)).toMatchObject({ id: branch });
    expect(await offRepo.getByIdInOrg(branch, "org-2")).toBeNull();
    await offRepo.demoteMains(org);
    expect((await offRepo.getByIdInOrg(main, org))!.isMain).toBe(false);
  });
});

describe("Organization/Office — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("org + offices med demoteMains", async () => {
    const db = handle.db;
    const org = uuidv7();
    const main = uuidv7();
    const branch = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(organizations).values(v({ id: org, name: "Byrå AB" }));
    await db.insert(offices).values(v({ id: main, organizationId: org, name: "Sthlm", isMain: true }));
    await db.insert(offices).values(v({ id: branch, organizationId: org, name: "Gbg", isMain: false }));
    const offRepo = new DrizzleOfficeRepository(handle.db as unknown as AppDb);
    expect(await new DrizzleOrganizationRepository(handle.db as unknown as AppDb).getById(org)).toMatchObject({ id: org });
    expect((await offRepo.listByOrg(org)).map((o) => o.id)).toEqual([main, branch]);
    expect(await offRepo.getByIdInOrg(branch, org)).toMatchObject({ id: branch });
    expect(await offRepo.getByIdInOrg(branch, uuidv7())).toBeNull();
    await offRepo.demoteMains(org);
    expect((await offRepo.getByIdInOrg(main, org))!.isMain).toBe(false);
  });
});
