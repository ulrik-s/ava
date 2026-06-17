/**
 * DocumentTemplateRepository-paritet (ADR 0020) — in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { documentTemplates, users } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleDocumentTemplateRepository } from "@/lib/server/repositories/drizzle-document-template-repository";
import { InMemoryDocumentTemplateRepository } from "@/lib/server/repositories/in-memory-document-template-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("DocumentTemplateRepository — in-memory", () => {
  it("listForOrg + getByIdInOrg (med skapar-namn)", async () => {
    const t1 = uuidv7();
    const userId = uuidv7();
    const source = prebakeJoins({
      users: [{ id: userId, name: "Anna" }],
      documentTemplates: [
        { id: t1, organizationId: "org-1", name: "Avtal", category: "A", content: "x", createdById: userId },
      ],
    } as DemoSource);
    const repo = new InMemoryDocumentTemplateRepository(new LocalStore(source, async () => {}));
    const list = await repo.listForOrg("org-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.createdBy?.name).toBe("Anna");
    expect(await repo.getByIdInOrg(t1, "org-1")).toMatchObject({ id: t1 });
    expect(await repo.getByIdInOrg(t1, "org-2")).toBeNull();
  });
});

describe("DocumentTemplateRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg (join skapare) + getByIdInOrg", async () => {
    const db = handle.db;
    const org = uuidv7();
    const userId = uuidv7();
    const t1 = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(users).values(v({ id: userId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(documentTemplates).values(v({ id: t1, organizationId: org, name: "Avtal", category: "A", content: "x", createdById: userId }));
    const repo = new DrizzleDocumentTemplateRepository(handle.db as unknown as AppDb);
    const list = await repo.listForOrg(org);
    expect(list).toHaveLength(1);
    expect(list[0]!.createdBy?.name).toBe("Anna");
    expect(await repo.getByIdInOrg(t1, org)).toMatchObject({ id: t1 });
    expect(await repo.getByIdInOrg(t1, uuidv7())).toBeNull();
  });
});
