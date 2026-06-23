/**
 * TaskRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle (pglite).
 * `listForUser` (ägar-/org-scope + matter-subset + filter) och `getOwned`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, tasks } from "@/lib/server/db/schema";
import { DrizzleTaskRepository } from "@/lib/server/repositories/drizzle-task-repository";
import { InMemoryTaskRepository } from "@/lib/server/repositories/in-memory-task-repository";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("TaskRepository — in-memory", () => {
  it("listForUser (ägar-scope + filter + matter) och getOwned", async () => {
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
    expect(await repo.getOwned(t1, userId, org)).toMatchObject({ id: t1 });
    expect(await repo.getOwned(t1, asId<"UserId">(uuidv7()), org)).toBeNull(); // annan user
  });
});

describe("TaskRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForUser (left-join matter) och getOwned", async () => {
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
    expect(await repo.getOwned(t1, userId, org)).toMatchObject({ id: t1 });
    expect(await repo.getOwned(t1, asId<"UserId">(uuidv7()), org)).toBeNull();
  });
});
