/**
 * Paritet (ADR 0020) för matter-läsningarna: MatterRepository.listForOrg/
 * getByIdWithContacts/listByResponsibleLawyer/listByNumberPrefix,
 * MatterContactRepository.getByIdInOrg/linkContact, ContactRepository.
 * findByPersonalNumber/findByOrgNumber. in-memory + Drizzle (pglite).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { contacts, documents, matterContacts, matters, timeEntries, users } from "@/lib/server/db/schema";
import { DrizzleContactRepository } from "@/lib/server/repositories/drizzle-contact-repository";
import { DrizzleMatterContactRepository } from "@/lib/server/repositories/drizzle-matter-contact-repository";
import { DrizzleMatterRepository } from "@/lib/server/repositories/drizzle-matter-repository";
import { InMemoryContactRepository } from "@/lib/server/repositories/in-memory-contact-repository";
import { InMemoryMatterContactRepository } from "@/lib/server/repositories/in-memory-matter-contact-repository";
import { InMemoryMatterRepository } from "@/lib/server/repositories/in-memory-matter-repository";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">("66666666-6666-7666-8666-666666666666");

describe("Matter-läsningar — in-memory", () => {
  it("listForOrg/_count + getByIdWithContacts + serie-läsningar + contact-dedup", async () => {
    const mId = asId<"MatterId">(uuidv7());
    const cId = asId<"ContactId">(uuidv7());
    const uId = asId<"UserId">(uuidv7());
    const mcId = asId<"MatterContactId">(uuidv7());
    const source = prebakeJoins({
      matters: [
        { id: mId, organizationId: ORG, matterNumber: "AA2026-0001", title: "Tvist", status: "ACTIVE", responsibleLawyerId: uId, createdAt: new Date("2026-01-01") },
      ],
      users: [{ id: uId, organizationId: ORG, name: "Anna" }],
      contacts: [{ id: cId, organizationId: ORG, name: "Klient AB", contactType: "COMPANY", personalNumber: null, orgNumber: "556-1" }],
      matterContacts: [{ id: mcId, matterId: mId, contactId: cId, role: "KLIENT" }],
      documents: [{ id: uuidv7(), matterId: mId, fileName: "a.pdf", folderId: null }],
      timeEntries: [{ id: uuidv7(), matterId: mId, userId: uId, minutes: 30, billable: true, hourlyRate: 1000, date: new Date() }],
    } as DemoSource);
    const store = new LocalStore(source, async () => {});
    const mRepo = new InMemoryMatterRepository(store);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcRepo = new InMemoryMatterContactRepository(store as any);
    const cRepo = new InMemoryContactRepository(store);

    const list = await mRepo.listForOrg(ORG, { page: 1, pageSize: 20 });
    expect(list.total).toBe(1);
    expect(list.matters[0]!.contacts[0]?.contact.name).toBe("Klient AB");
    expect(list.matters[0]!._count).toMatchObject({ documents: 1, timeEntries: 1, contacts: 1 });
    expect((await mRepo.listForOrg(ORG, { search: "tvist", page: 1, pageSize: 20 })).total).toBe(1);
    expect((await mRepo.listForOrg(ORG, { search: "saknas", page: 1, pageSize: 20 })).total).toBe(0);

    const detail = await mRepo.getByIdWithContacts(mId, ORG);
    expect(detail?.contacts).toHaveLength(1);
    expect(await mRepo.getByIdWithContacts(mId, asId<"OrganizationId">(uuidv7()))).toBeNull();

    expect((await mRepo.listByResponsibleLawyer(ORG, uId)).length).toBe(1);
    expect((await mRepo.listByNumberPrefix(ORG, "AA2026-")).length).toBe(1);

    expect(await mcRepo.getByIdInOrg(mcId, ORG)).toMatchObject({ id: mcId });
    expect(await mcRepo.getByIdInOrg(mcId, asId<"OrganizationId">(uuidv7()))).toBeNull();

    expect((await cRepo.findByOrgNumber(ORG, "556-1"))?.id).toBe(cId);
    expect(await cRepo.findByPersonalNumber(ORG, "x")).toBeNull();
  });
});

describe("Matter-läsningar — Drizzle (pglite)", () => {
  let handle: TestDbHandle;
  beforeAll(async () => { handle = await createTestDb(); });
  afterAll(async () => { await handle.close(); });

  it("listForOrg/_count + getByIdWithContacts + serie + contact-dedup + linkContact", async () => {
    const db = handle.db;
    const org = asId<"OrganizationId">(uuidv7());
    const mId = asId<"MatterId">(uuidv7());
    const cId = asId<"ContactId">(uuidv7());
    const uId = asId<"UserId">(uuidv7());
    const mcId = asId<"MatterContactId">(uuidv7());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await db.insert(matters).values(v({ id: mId, organizationId: org, matterNumber: "AA2026-0001", title: "Tvist", status: "ACTIVE", responsibleLawyerId: uId }));
    await db.insert(users).values(v({ id: uId, organizationId: org, email: "a@x", name: "Anna" }));
    await db.insert(contacts).values(v({ id: cId, organizationId: org, name: "Klient AB", contactType: "COMPANY", orgNumber: "556-1" }));
    await db.insert(matterContacts).values(v({ id: mcId, matterId: mId, contactId: cId, role: "KLIENT" }));
    await db.insert(documents).values(v({ id: uuidv7(), matterId: mId, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "p", uploadedById: uId }));
    await db.insert(timeEntries).values(v({ id: uuidv7(), matterId: mId, userId: uId, minutes: 30, billable: true, hourlyRate: 1000, description: "x", date: new Date() }));
    const mRepo = new DrizzleMatterRepository(db);
    const mcRepo = new DrizzleMatterContactRepository(db);
    const cRepo = new DrizzleContactRepository(db);

    const list = await mRepo.listForOrg(org, { page: 1, pageSize: 20 });
    expect(list.total).toBe(1);
    expect(list.matters[0]!.contacts[0]?.contact.name).toBe("Klient AB");
    expect(list.matters[0]!._count).toMatchObject({ documents: 1, timeEntries: 1, contacts: 1 });
    expect((await mRepo.listForOrg(org, { search: "tvist", page: 1, pageSize: 20 })).total).toBe(1);
    expect((await mRepo.listForOrg(org, { search: "klient", page: 1, pageSize: 20 })).total).toBe(1); // via kontaktnamn
    expect((await mRepo.listForOrg(org, { search: "saknas", page: 1, pageSize: 20 })).total).toBe(0);

    const detail = await mRepo.getByIdWithContacts(mId, org);
    expect(detail?.contacts).toHaveLength(1);
    expect(detail?._count.documents).toBe(1);
    expect(await mRepo.getByIdWithContacts(mId, asId<"OrganizationId">(uuidv7()))).toBeNull();

    expect((await mRepo.listByResponsibleLawyer(org, uId)).length).toBe(1);
    expect((await mRepo.listByNumberPrefix(org, "AA2026-")).length).toBe(1);

    expect(await mcRepo.getByIdInOrg(mcId, org)).toMatchObject({ id: mcId });
    expect(await mcRepo.getByIdInOrg(mcId, asId<"OrganizationId">(uuidv7()))).toBeNull();
    expect((await cRepo.findByOrgNumber(org, "556-1"))?.id).toBe(cId);

    const link = await mcRepo.linkContact({ id: uuidv7(), matterId: mId, contactId: cId, role: "MOTPART" } as never);
    expect(link.contact.name).toBe("Klient AB");
  });
});
