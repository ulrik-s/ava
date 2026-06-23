/**
 * Paritet (ADR 0020) för ConflictCheckRepository (listHistory) +
 * MatterContactRepository (findForConflict) — in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { conflictChecks, contacts, matterContacts, matters, users } from "@/lib/server/db/schema";
import { DrizzleConflictCheckRepository } from "@/lib/server/repositories/drizzle-conflict-check-repository";
import { DrizzleMatterContactRepository } from "@/lib/server/repositories/drizzle-matter-contact-repository";
import { InMemoryConflictCheckRepository } from "@/lib/server/repositories/in-memory-conflict-check-repository";
import { InMemoryMatterContactRepository } from "@/lib/server/repositories/in-memory-matter-contact-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">("33333333-3333-7333-8333-333333333333");

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
    const org = asId<"OrganizationId">(uuidv7());
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
    const mc = new DrizzleMatterContactRepository(db);
    const cc = new DrizzleConflictCheckRepository(db);

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

// ─── MatterContactRepository: CRUD-/läs-metoderna (getByIdInOrg, findLink,
//     listContactsForMatter, linkContact) — paritet in-memory + Drizzle. ───

const ORG2 = asId<"OrganizationId">("44444444-4444-7444-8444-444444444444");
const OTHER_ORG = asId<"OrganizationId">("55555555-5555-7555-8555-555555555555");

describe("MatterContactRepository — läs-/skriv-metoder (in-memory)", () => {
  const mId = asId<"MatterId">(uuidv7());
  const cKli = asId<"ContactId">(uuidv7());
  const cMot = asId<"ContactId">(uuidv7());
  const linkKli = asId<"MatterContactId">(uuidv7());
  const linkMot = asId<"MatterContactId">(uuidv7());

  function buildStore(): LocalStore {
    const source = prebakeJoins({
      matters: [{ id: mId, organizationId: ORG2, matterNumber: "2026-9", title: "Y" }],
      contacts: [
        { id: cKli, organizationId: ORG2, name: "Klient AB", contactType: "COMPANY" },
        { id: cMot, organizationId: ORG2, name: "Motpart", contactType: "PERSON" },
      ],
      matterContacts: [
        { id: linkKli, matterId: mId, contactId: cKli, role: "KLIENT" },
        { id: linkMot, matterId: mId, contactId: cMot, role: "MOTPART" },
      ],
    } as DemoSource);
    return new LocalStore(source, async () => {});
  }

  function repo(store: LocalStore): InMemoryMatterContactRepository {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new InMemoryMatterContactRepository(store as any);
  }

  it("getByIdInOrg: hittar i rätt org, null för annan org/saknad id", async () => {
    const mc = repo(buildStore());
    const found = await mc.getByIdInOrg(linkKli, ORG2);
    expect(found?.id).toBe(linkKli);
    expect(await mc.getByIdInOrg(linkKli, OTHER_ORG)).toBeNull();
    expect(await mc.getByIdInOrg(asId<"MatterContactId">(uuidv7()), ORG2)).toBeNull();
  });

  it("findLink: matchar (ärende, kontakt, roll); null vid annan roll", async () => {
    const mc = repo(buildStore());
    const link = await mc.findLink(mId, cKli, "KLIENT");
    expect(link?.id).toBe(linkKli);
    expect(await mc.findLink(mId, cKli, "MOTPART")).toBeNull();
  });

  it("listContactsForMatter: returnerar ärendets kopplade kontakter", async () => {
    const mc = repo(buildStore());
    const list = await mc.listContactsForMatter(mId);
    expect(list.map((c) => c.id).sort()).toEqual([cKli, cMot].sort());
  });

  it("linkContact: skapar länk + går att slå upp via findLink", async () => {
    const store = buildStore();
    const mc = repo(store);
    const cNew = asId<"ContactId">(uuidv7());
    // Lägg in kontakten så enrichment har något att joina mot.
    await store.contacts.create({ data: { id: cNew, organizationId: ORG2, name: "Vittne", contactType: "PERSON" } as never });
    const created = await mc.linkContact({ id: uuidv7(), matterId: mId, contactId: cNew, role: "VITTNE" } as never);
    expect(created.matterId).toBe(mId);
    expect(created.contactId).toBe(cNew);
    expect(await mc.findLink(mId, cNew, "VITTNE")).not.toBeNull();
  });
});

describe("MatterContactRepository — läs-/skriv-metoder (Drizzle/pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("getByIdInOrg / findLink / listContactsForMatter / linkContact", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const cKli = asId<"ContactId">(uuidv7());
    const cMot = asId<"ContactId">(uuidv7());
    const linkKli = asId<"MatterContactId">(uuidv7());
    const linkMot = asId<"MatterContactId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "2026-9", title: "Y" }));
    await db.insert(contacts).values(v({ id: cKli, organizationId: org, name: "Klient AB", contactType: "COMPANY" }));
    await db.insert(contacts).values(v({ id: cMot, organizationId: org, name: "Motpart", contactType: "PERSON" }));
    await db.insert(matterContacts).values(v({ id: linkKli, matterId: mId, contactId: cKli, role: "KLIENT" }));
    await db.insert(matterContacts).values(v({ id: linkMot, matterId: mId, contactId: cMot, role: "MOTPART" }));
    const mc = new DrizzleMatterContactRepository(db);

    // getByIdInOrg
    expect((await mc.getByIdInOrg(linkKli, org))?.id).toBe(linkKli);
    expect(await mc.getByIdInOrg(linkKli, asId<"OrganizationId">(uuidv7()))).toBeNull();

    // findLink
    expect((await mc.findLink(mId, cKli, "KLIENT"))?.id).toBe(linkKli);
    expect(await mc.findLink(mId, cKli, "MOTPART")).toBeNull();

    // listContactsForMatter
    const list = await mc.listContactsForMatter(mId);
    expect(list.map((c) => c.id).sort()).toEqual([cKli, cMot].sort());

    // linkContact — skapar länk + returnerar med kontakten joinad
    const cNew = asId<"ContactId">(uuidv7());
    await db.insert(contacts).values(v({ id: cNew, organizationId: org, name: "Vittne", contactType: "PERSON" }));
    const created = await mc.linkContact({ id: uuidv7(), matterId: mId, contactId: cNew, role: "VITTNE" } as never);
    expect(created.contactId).toBe(cNew);
    expect(created.contact.id).toBe(cNew);
    expect((await mc.findLink(mId, cNew, "VITTNE"))?.id).toBe(created.id);
  });
});
