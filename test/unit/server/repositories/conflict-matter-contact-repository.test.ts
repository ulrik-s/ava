/**
 * Paritet (ADR 0020) för ConflictCheckRepository (listHistory) +
 * MatterContactRepository (findForConflict) — in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { conflictChecks, contacts, matterContacts, matters, users } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { DrizzleConflictCheckRepository } from "@/lib/server/repositories/drizzle-conflict-check-repository";
import { DrizzleMatterContactRepository } from "@/lib/server/repositories/drizzle-matter-contact-repository";
import { InMemoryConflictCheckRepository } from "@/lib/server/repositories/in-memory-conflict-check-repository";
import { InMemoryMatterContactRepository } from "@/lib/server/repositories/in-memory-matter-contact-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = "33333333-3333-7333-8333-333333333333";

describe("Conflict/MatterContact repos — in-memory", () => {
  it("findForConflict (nummer + alla) + listHistory", async () => {
    const mId = uuidv7();
    const cMot = uuidv7();
    const cKli = uuidv7();
    const uId = uuidv7();
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG, matterNumber: "2026-1", title: "X" }],
      users: [{ id: uId, name: "Jurist" }],
      contacts: [
        { id: cMot, organizationId: ORG, name: "Anna", contactType: "PERSON", personalNumber: "19850225-6655" },
        { id: cKli, organizationId: ORG, name: "Klient AB", contactType: "COMPANY" },
      ],
      matterContacts: [
        { id: uuidv7(), matterId: mId, contactId: cMot, role: "MOTPART" },
        { id: uuidv7(), matterId: mId, contactId: cKli, role: "KLIENT" },
      ],
      conflictChecks: [
        { id: uuidv7(), searchTerm: "anna", searchType: "name", results: [], checkedById: uId, createdAt: new Date() },
      ],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mc = new InMemoryMatterContactRepository(store as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = new InMemoryConflictCheckRepository(store as any);

    const byNumber = await mc.findForConflict(ORG, "19850225");
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]!.contact.name).toBe("Anna");
    expect(byNumber[0]!.matter.contacts[0]?.contact.name).toBe("Klient AB");
    expect((await mc.findForConflict(ORG)).length).toBe(2); // MOTPART + KLIENT
    expect(await mc.findForConflict(ORG, "0000")).toHaveLength(0);

    const hist = await cc.listHistory(1, 20);
    expect(hist.total).toBe(1);
    expect(hist.checks[0]!.checkedBy?.name).toBe("Jurist");
  });
});

describe("Conflict/MatterContact repos — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("findForConflict (nummer + alla) + listHistory", async () => {
    const db = handle.db;
    const org = uuidv7();
    const mId = uuidv7();
    const cMot = uuidv7();
    const cKli = uuidv7();
    const uId = uuidv7();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-1", title: "X" }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "j@x", name: "Jurist" }));
    await db.insert(contacts).values(v({ id: cMot, organizationId: org, name: "Anna", contactType: "PERSON", personalNumber: "19850225-6655" }));
    await db.insert(contacts).values(v({ id: cKli, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cMot, role: "MOTPART" }));
    await db.insert(matterContacts).values(v({ id: uuidv7(), matterId: mId, contactId: cKli, role: "KLIENT" }));
    await db.insert(conflictChecks).values(v({ id: uuidv7(), searchTerm: "anna", searchType: "name", results: [], checkedById: uId }));
    const mc = new DrizzleMatterContactRepository(db as unknown as AppDb);
    const cc = new DrizzleConflictCheckRepository(db as unknown as AppDb);

    const byNumber = await mc.findForConflict(org, "19850225");
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]!.contact.name).toBe("Anna");
    expect(byNumber[0]!.matter.contacts[0]?.contact.name).toBe("Klient AB");
    expect((await mc.findForConflict(org)).length).toBe(2);
    expect(await mc.findForConflict(org, "0000")).toHaveLength(0);

    const hist = await cc.listHistory(1, 20);
    expect(hist.total).toBe(1);
    expect(hist.checks[0]!.checkedBy?.name).toBe("Jurist");
  });
});
