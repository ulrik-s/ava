/**
 * TaskRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle (pglite).
 * `listForUser` (ägar-/org-scope + matter-subset + filter) och `getOwned`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { matters, tasks } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleTaskRepository } from "@/lib/server/repositories/drizzle-task-repository";
import { InMemoryTaskRepository } from "@/lib/server/repositories/in-memory-task-repository";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("TaskRepository — in-memory", () => {
  it("listForUser (ägar-scope + filter + matter) och getOwned", async () => {
    const userId = uuidv7();
    const mId = uuidv7();
    const t1 = uuidv7();
    const store = new LocalStore({
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T" }],
      tasks: [
        { id: t1, userId, organizationId: "org-1", title: "A", status: "TODO", matterId: mId },
        { id: uuidv7(), userId, organizationId: "org-1", title: "B", status: "DONE", matterId: null },
        { id: uuidv7(), userId: uuidv7(), organizationId: "org-1", title: "Annan", status: "TODO" },
      ],
    }, async () => {});
    const repo = new InMemoryTaskRepository(store);
    expect(await repo.listForUser(userId, "org-1", {})).toHaveLength(2); // bara egna
    expect(await repo.listForUser(userId, "org-1", { status: "DONE" })).toHaveLength(1);
    const withMatter = (await repo.listForUser(userId, "org-1", { status: "TODO" }))[0]!;
    expect(withMatter.matter?.matterNumber).toBe("2026-1");
    expect(await repo.getOwned(t1, userId, "org-1")).toMatchObject({ id: t1 });
    expect(await repo.getOwned(t1, uuidv7(), "org-1")).toBeNull(); // annan user
  });
});

describe("TaskRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForUser (left-join matter) och getOwned", async () => {
    const db = handle.db;
    const org = uuidv7();
    const userId = uuidv7();
    const mId = uuidv7();
    const t1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T" }));
    await db.insert(tasks).values(v({ id: t1, userId, organizationId: org, title: "A", status: "TODO", matterId: mId }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId, organizationId: org, title: "B", status: "DONE" }));
    await db.insert(tasks).values(v({ id: uuidv7(), userId: uuidv7(), organizationId: org, title: "Annan", status: "TODO" }));
    const repo = new DrizzleTaskRepository(handle.db as unknown as AppDb);
    expect(await repo.listForUser(userId, org, {})).toHaveLength(2);
    expect(await repo.listForUser(userId, org, { status: "DONE" })).toHaveLength(1);
    const withMatter = (await repo.listForUser(userId, org, { status: "TODO" }))[0]!;
    expect(withMatter.matter?.matterNumber).toBe("2026-1");
    expect(await repo.getOwned(t1, userId, org)).toMatchObject({ id: t1 });
    expect(await repo.getOwned(t1, uuidv7(), org)).toBeNull();
  });
});
