/**
 * ContactRepository-paritet (ADR 0020, #409 fan-out) — in-memory + Drizzle
 * (pglite). `listForOrg` (topp-nivå + _count + sök) och `getByIdFull`
 * (barn/förälder/ärende-kopplingar).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, matterContacts, matters } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleContactRepository } from "@/lib/server/repositories/drizzle-contact-repository";
import { InMemoryContactRepository } from "@/lib/server/repositories/in-memory-contact-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("ContactRepository — in-memory", () => {
  function seed() {
    const c1 = uuidv7();
    const child = uuidv7();
    const mId = uuidv7();
    // prebakeJoins speglar demo-runtime → nästlade relationer (matterLinks.matter)
    // resolvas, precis som i produktion.
    const source = prebakeJoins({
      contacts: [
        { id: c1, organizationId: "org-1", name: "Anna AB", contactType: "COMPANY", parentId: null },
        { id: child, organizationId: "org-1", name: "Anställd", contactType: "PERSON", parentId: c1 },
      ],
      matters: [{ id: mId, organizationId: "org-1", matterNumber: "2026-1", title: "T", status: "ACTIVE" }],
      matterContacts: [{ id: uuidv7(), matterId: mId, contactId: c1, role: "KLIENT" }],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    return { store, c1, child };
  }

  it("listForOrg: topp-nivå + _count + sök", async () => {
    const { store, c1 } = seed();
    const repo = new InMemoryContactRepository(store);
    const res = await repo.listForOrg("org-1", { page: 1, pageSize: 50 });
    expect(res.total).toBe(1); // child (parentId satt) exkluderad
    expect(res.contacts[0]!.id).toBe(c1);
    expect(res.contacts[0]!._count.children).toBe(1);
    expect(res.contacts[0]!._count.matterLinks).toBe(1);
    expect((await repo.listForOrg("org-1", { search: "Anna", page: 1, pageSize: 50 })).total).toBe(1);
    expect((await repo.listForOrg("org-1", { search: "Zzz", page: 1, pageSize: 50 })).total).toBe(0);
    expect((await repo.listForOrg("org-2", { page: 1, pageSize: 50 })).total).toBe(0); // fel org
  });

  it("getByIdFull: barn + ärende-kopplingar, org-scopad", async () => {
    const { store, c1 } = seed();
    const repo = new InMemoryContactRepository(store);
    const full = await repo.getByIdFull(c1, "org-1");
    expect(full?.children).toHaveLength(1);
    expect(full?.matterLinks).toHaveLength(1);
    expect(full?.matterLinks[0]!.matter?.matterNumber).toBe("2026-1");
    expect(await repo.getByIdFull(c1, "org-2")).toBeNull(); // fel org
  });
});

describe("ContactRepository — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg + getByIdFull (subquery-_count, join-detalj)", async () => {
    const db = handle.db;
    const org = uuidv7();
    const c1 = uuidv7();
    const child = uuidv7();
    const mId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(contacts).values(v({ id: c1, organizationId: org, name: "Anna AB", contactType: "COMPANY" }));
    await db.insert(contacts).values(v({ id: child, organizationId: org, name: "Anställd", contactType: "PERSON", parentId: c1 }));
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "T", status: "ACTIVE" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: c1, role: "KLIENT" }));
    const repo = new DrizzleContactRepository(handle.db as unknown as AppDb);

    const res = await repo.listForOrg(org, { page: 1, pageSize: 50 });
    expect(res.total).toBe(1); // child exkluderad (parentId satt)
    expect(res.contacts[0]!.id).toBe(c1);
    expect(res.contacts[0]!._count.children).toBe(1);
    expect(res.contacts[0]!._count.matterLinks).toBe(1);
    expect((await repo.listForOrg(org, { search: "anna", page: 1, pageSize: 50 })).total).toBe(1); // ilike
    expect((await repo.listForOrg(org, { search: "Zzz", page: 1, pageSize: 50 })).total).toBe(0);

    const full = await repo.getByIdFull(c1, org);
    expect(full?.children).toHaveLength(1);
    expect(full?.matterLinks).toHaveLength(1);
    expect(full?.matterLinks[0]!.matter.matterNumber).toBe("2026-1");
    expect(await repo.getByIdFull(c1, uuidv7())).toBeNull();
  });
});
