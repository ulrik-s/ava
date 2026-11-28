/**
 * TaskRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle (pglite).
 * `listForUser` (ägar-/org-scope + matter-subset + filter) och `getByIdInOrg` (#1231).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, tasks } from "@/lib/server/db/schema";
import { DrizzleTaskRepository } from "@/lib/server/repositories/drizzle-task-repository";
import { InMemoryTaskRepository } from "@/lib/server/repositories/in-memory-task-repository";
import { asId, type OrganizationId, type TaskId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { DRIZZLE_NAME, type OpenRepos, openDrizzleRepos, openInMemoryRepos } from "./contract-backends";

describe("TaskRepository — in-memory", () => {
  it("listForUser (ägar-scope + filter + matter) och getByIdInOrg", async () => {
    const userId = asId<"UserId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const t1 = asId<"TaskId">(uuidv7());
    const org = asId<"OrganizationId">("org-1");
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }],
      tasks: [
        { id: t1, userId, organizationId: org, title: "A", status: "TODO", matterId: mId },
        { id: asId<"TaskId">(uuidv7()), userId, organizationId: org, title: "B", status: "DONE", matterId: null },
        { id: asId<"TaskId">(uuidv7()), userId: asId<"UserId">(uuidv7()), organizationId: org, title: "Annan", status: "TODO" },
      ],
    }, async () => {});
    const repo = new InMemoryTaskRepository(store);
    expect(await repo.listForUser(userId, org, {})).toHaveLength(2); // bara egna
    expect(await repo.listForUser(userId, org, { status: "DONE" })).toHaveLength(1);
    const withMatter = (await repo.listForUser(userId, org, { status: "TODO" }))[0]!;
    expect(withMatter.matter?.matterNumber).toBe("2026-1");
    expect(await repo.getByIdInOrg(t1, org)).toMatchObject({ id: t1 }); // vem som helst på byrån
    expect(await repo.getByIdInOrg(t1, asId<"OrganizationId">("org-2"))).toBeNull(); // annan byrå
    expect(await repo.getByIdInOrg(asId<"TaskId">(uuidv7()), org)).toBeNull(); // saknas
  });

  it("getByIdInOrg: mjukraderad uppgift → null", async () => {
    const org = asId<"OrganizationId">("org-1");
    const t = asId<"TaskId">(uuidv7());
    const store = new LocalStore({
      tasks: [{ id: t, userId: asId<"UserId">(uuidv7()), organizationId: org, title: "Raderad", status: "TODO", deletedAt: new Date() }],
    }, async () => {});
    expect(await new InMemoryTaskRepository(store).getByIdInOrg(t, org)).toBeNull();
  });

  it("listForMatter: ALLA användares uppgifter i ärendet (#1162), bara den org:en", async () => {
    const org = asId<"OrganizationId">("org-1");
    const mId = asId<"MatterId">(uuidv7());
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }],
      tasks: [
        { id: asId<"TaskId">(uuidv7()), userId: asId<"UserId">(uuidv7()), organizationId: org, title: "Anna", status: "TODO", matterId: mId },
        { id: asId<"TaskId">(uuidv7()), userId: asId<"UserId">(uuidv7()), organizationId: org, title: "Bo", status: "DONE", matterId: mId },
        { id: asId<"TaskId">(uuidv7()), userId: asId<"UserId">(uuidv7()), organizationId: org, title: "Annat ärende", status: "TODO", matterId: null },
        { id: asId<"TaskId">(uuidv7()), userId: asId<"UserId">(uuidv7()), organizationId: asId<"OrganizationId">("org-2"), title: "Annan byrå", status: "TODO", matterId: mId },
      ],
    }, async () => {});
    const rows = await new InMemoryTaskRepository(store).listForMatter(mId, org);
    expect(rows.map((r) => r.title).sort()).toEqual(["Anna", "Bo"]);
  });
});

describe("TaskRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForUser (left-join matter) och getByIdInOrg", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const userId = asId<"UserId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const t1 = asId<"TaskId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(tasks).values(v({ id: t1, userId, organizationId: org, title: "A", status: "TODO", matterId: mId }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId, organizationId: org, title: "B", status: "DONE" }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: org, title: "Annan", status: "TODO" }));
    const repo = new DrizzleTaskRepository(handle.db);
    expect(await repo.listForUser(userId, org, {})).toHaveLength(2);
    expect(await repo.listForUser(userId, org, { status: "DONE" })).toHaveLength(1);
    const withMatter = (await repo.listForUser(userId, org, { status: "TODO" }))[0]!;
    expect(withMatter.matter?.matterNumber).toBe("2026-1");
    expect(await repo.getByIdInOrg(t1, org)).toMatchObject({ id: t1 }); // vem som helst på byrån
    expect(await repo.getByIdInOrg(t1, asId<"OrganizationId">(uuidv7()))).toBeNull(); // annan byrå
    const gone = asId<"TaskId">(uuidv7());
    await db.insert(tasks).values(v({ id: gone, userId, organizationId: org, title: "Raderad", status: "TODO", deletedAt: new Date() }));
    expect(await repo.getByIdInOrg(gone, org)).toBeNull(); // mjukraderad
  });

  it("listForMatter: alla användares, ej raderade, bara org:en (#1162)", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-2", title: "T" }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: org, title: "Anna", status: "TODO", matterId: mId, dueAt: new Date("2026-02-01") }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: org, title: "Bo", status: "TODO", matterId: mId, dueAt: new Date("2026-01-01") }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: org, title: "Raderad", status: "TODO", matterId: mId, deletedAt: new Date() }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: uuidv7(), title: "Annan byrå", status: "TODO", matterId: mId }));
    const rows = await new DrizzleTaskRepository(db).listForMatter(mId, org);
    expect(rows.map((r) => r.title)).toEqual(["Bo", "Anna"]); // dueAt asc
    expect(rows[0]!.matter?.matterNumber).toBe("2026-2");
  });
});

describe.each([
  ["in-memory", () => Promise.resolve(openInMemoryRepos())],
  [DRIZZLE_NAME, () => openDrizzleRepos()],
] as const)("TaskRepository.existingIdsInOrg (#2121) — %s", (_name, open) => {
  let repos: OpenRepos;
  beforeEach(async () => { repos = await open(); });
  afterEach(async () => { await repos.close(); });

  it("ger levande och mjukraderade uppgifter i byrån, inte en annan byrås eller saknade", async () => {
    const org = asId<"OrganizationId">(uuidv7());
    const task = async (organizationId: OrganizationId): Promise<TaskId> => {
      const id = asId<"TaskId">(uuidv7());
      await repos.repos.tasks.create({ id, organizationId, userId: asId<"UserId">(uuidv7()), title: "T", status: "TODO" } as never);
      return id;
    };
    const alive = await task(org);
    const gone = await task(org);
    await repos.repos.tasks.softDelete(gone);
    const other = await task(asId<"OrganizationId">(uuidv7()));
    const missing = asId<"TaskId">(uuidv7());
    const found = await repos.repos.tasks.existingIdsInOrg([alive, gone, other, missing], org);
    expect([...found].sort()).toEqual([alive, gone].sort());
    expect(await repos.repos.tasks.getByIds([alive, gone])).toHaveLength(1); // getByIds utelämnar raderade
    expect((await repos.repos.tasks.existingIdsInOrg([], org)).size).toBe(0);
  });
});
