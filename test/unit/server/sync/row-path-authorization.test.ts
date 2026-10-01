/**
 * Radvägens behörighet (#1344), mot Postgres.
 *
 * Rollen läses ur användarraden. Radvägen tog emot `user`, `organization`,
 * `office`, `orgPreference` och `documentTemplate` från alla medlemmar, så en
 * medlem kunde pusha `{ entity: "user", row: { id: jag, role: "ADMIN" } }` och
 * bli admin — eller ändra byråns bankgiro. Jävskontrollens logg var inte
 * avgränsad alls. Nu:
 *   - administrationen tas inte emot som rader, av någon roll (servern kör om
 *     routrarna i procedurkön, där rollen prövas);
 *   - jävskontrollens logg hör till byrån via den som körde kontrollen;
 *   - referenser får inte peka på en annan byrås rader, och vem som skapade en
 *     rad går inte att förfalska.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { ROW_POLICY_REASONS } from "@/lib/server/sync/row-push-policy";
import { asId } from "@/lib/shared/schemas/ids";
import { PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

/** En innehållsadresserad sökväg (sha256) — dokumentets eget innehåll (#1372). */
const SHA_PATH = `documents/content/${"a".repeat(64)}`;
const ORG_A = uuidv7();
const ORG_B = uuidv7();
const ADMIN_A = uuidv7();
const MEMBER_A = uuidv7();
const USER_B = uuidv7();
const MATTER_A = uuidv7();
const MATTER_B = uuidv7();
const CONTACT_B = uuidv7();
const DOC_B = uuidv7();
const FOLDER_B = uuidv7();

const member = pusher(ORG_A, MEMBER_A);
const admin = pusher(ORG_A, ADMIN_A);
const roles = [["medlem", member], ["admin", admin]] as const;

function mut(entity: string, kind: QueuedMutation["kind"], row: Record<string, unknown>, baseVersion = 1): QueuedMutation {
  return { mutationId: uuidv7(), entity, kind, row, baseVersion, enqueuedAt: 0 };
}

describe("radvägens behörighet (#1344)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
    await repos.organizations.create({ id: ORG_A, name: "Byrå A", bankgiro: "111-1111" } as never);
    await repos.organizations.create({ id: ORG_B, name: "Byrå B" } as never);
    await repos.users.create({ id: ADMIN_A, organizationId: ORG_A, email: "admin@a.se", name: "Admin", role: "ADMIN", active: true } as never);
    await repos.users.create({ id: MEMBER_A, organizationId: ORG_A, email: "medlem@a.se", name: "Medlem", role: "LAWYER", active: true } as never);
    await repos.users.create({ id: USER_B, organizationId: ORG_B, email: "b@b.se", name: "B", role: "ADMIN", active: true } as never);
    await repos.matters.create({ id: MATTER_A, organizationId: ORG_A, title: "A", status: "ACTIVE", matterNumber: "2026-0001" } as never);
    await repos.matters.create({ id: MATTER_B, organizationId: ORG_B, title: "B", status: "ACTIVE", matterNumber: "2026-0001" } as never);
    await repos.contacts.create({ id: CONTACT_B, organizationId: ORG_B, name: "B:s klient" } as never);
    await repos.documentFolders.create({ id: FOLDER_B, matterId: MATTER_B, name: "B:s mapp", parentId: null } as never);
    await repos.documents.create({ id: DOC_B, matterId: MATTER_B, fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: "documents/content/b", uploadedById: USER_B } as never);
  });
  afterAll(async () => { await handle.close(); });

  describe("administrationen tas inte emot som rader — av någon roll", () => {
    for (const [role, who] of roles) {
      it(`${role}: { user, id: jag, role: ADMIN } → avvisad, rollen orörd`, async () => {
        const res = await sync.push(who, mut("user", "update", { id: MEMBER_A, organizationId: ORG_A, role: "ADMIN" }));
        expect(res).toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON, current: { id: MEMBER_A, role: "LAWYER" } });
        expect((await repos.users.getById(asId<"UserId">(MEMBER_A)))?.role).toBe("LAWYER");
      });

      it(`${role}: ny användare, byte av e-post och borttagning → avvisade`, async () => {
        const fresh = uuidv7();
        expect(await sync.push(who, mut("user", "create", { id: fresh, organizationId: ORG_A, email: "ny@a.se", name: "Ny", role: "ADMIN" })))
          .toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON });
        expect(await repos.users.getById(asId<"UserId">(fresh))).toBeNull();
        expect(await sync.push(who, mut("user", "update", { id: ADMIN_A, email: "kapad@evil.se" }))).toMatchObject({ status: "conflict" });
        expect(await sync.push(who, mut("user", "delete", { id: ADMIN_A }))).toMatchObject({ status: "conflict" });
        expect(await repos.users.getById(asId<"UserId">(ADMIN_A))).toMatchObject({ email: "admin@a.se", deletedAt: null });
      });

      it(`${role}: byråns bankgiro, kontor, standardvyer och mallar → avvisade`, async () => {
        expect(await sync.push(who, mut("organization", "update", { id: ORG_A, bankgiro: "999-9999" })))
          .toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON });
        expect((await repos.organizations.getById(asId<"OrganizationId">(ORG_A)))?.bankgiro).toBe("111-1111");
        for (const [entity, row] of [
          ["office", { id: uuidv7(), organizationId: ORG_A, name: "Filial" }],
          ["orgPreference", { id: uuidv7(), organizationId: ORG_A, key: "list.matters", prefs: {} }],
          ["documentTemplate", { id: uuidv7(), organizationId: ORG_A, name: "Mall", content: "x", createdById: who.userId }],
        ] as const) {
          expect(await sync.push(who, mut(entity, "create", row))).toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON });
        }
      });
    }

    it("en annan byrås användare: byrån prövas först", async () => {
      expect(await sync.push(member, mut("user", "update", { id: USER_B, role: "LAWYER" }))).toEqual({ status: "conflict", reason: "annan byrå" });
    });
  });

  describe("jävskontrollens logg hör till byrån via den som körde den", () => {
    it("egen kontroll i eget namn → accepterad och loggad för byrån", async () => {
      const id = uuidv7();
      const cursor = (await sync.pull(ORG_A, 0)).cursor;
      const res = await sync.push(member, mut("conflictCheck", "create", { id, searchTerm: "Bo Berg", searchType: "both", results: [], checkedById: MEMBER_A }));
      expect(res).toMatchObject({ status: "accepted", row: { id, checkedById: MEMBER_A } });
      expect((await sync.pull(ORG_A, cursor)).changes.map((c) => c.row.id)).toContain(id);
      expect((await sync.pull(ORG_B, 0)).changes.map((c) => c.row.id)).not.toContain(id);
    });

    it("en kontroll i en annan byrås användares namn → annan byrå, skapas inte", async () => {
      const id = uuidv7();
      expect(await sync.push(member, mut("conflictCheck", "create", { id, searchTerm: "x", searchType: "both", results: [], checkedById: USER_B })))
        .toEqual({ status: "conflict", reason: "annan byrå" });
      expect(await repos.conflictChecks.getById(asId<"ConflictCheckId">(id))).toBeNull();
    });

    it("en annan byrås kontroll kan inte skrivas över eller tas bort via dess id", async () => {
      const id = uuidv7();
      await repos.conflictChecks.create({ id, searchTerm: "B:s sökning", searchType: "both", results: [], checkedById: USER_B } as never);
      expect(await sync.push(member, mut("conflictCheck", "create", { id, searchTerm: "kapad", searchType: "both", results: [], checkedById: MEMBER_A })))
        .toEqual({ status: "conflict", reason: "annan byrå" });
      expect(await sync.push(member, mut("conflictCheck", "update", { id, searchTerm: "kapad" }))).toEqual({ status: "conflict", reason: "annan byrå" });
      expect(await sync.push(member, mut("conflictCheck", "delete", { id }))).toEqual({ status: "conflict", reason: "annan byrå" });
      expect(await repos.conflictChecks.getById(asId<"ConflictCheckId">(id))).toMatchObject({ searchTerm: "B:s sökning", deletedAt: null });
    });

    it("en kollegas namn → avvisad; okänd användare → okänd byrå; egen logg kan inte ändras", async () => {
      expect(await sync.push(member, mut("conflictCheck", "create", { id: uuidv7(), searchTerm: "x", searchType: "both", results: [], checkedById: ADMIN_A })))
        .toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.actor });
      expect(await sync.push(member, mut("conflictCheck", "create", { id: uuidv7(), searchTerm: "x", searchType: "both", results: [], checkedById: uuidv7() })))
        .toEqual({ status: "conflict", reason: "okänd byrå" });
      const own = uuidv7();
      await sync.push(member, mut("conflictCheck", "create", { id: own, searchTerm: "egen", searchType: "both", results: [], checkedById: MEMBER_A }));
      expect(await sync.push(member, mut("conflictCheck", "update", { id: own, searchTerm: "ändrad" }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.appendOnly });
    });
  });

  describe("referenser får inte peka på en annan byrås rader", () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["task i eget namn men i B:s ärende", { id: uuidv7(), organizationId: ORG_A, userId: MEMBER_A, matterId: MATTER_B, title: "t", status: "TODO" }],
      ["task tilldelad B:s användare", { id: uuidv7(), organizationId: ORG_A, userId: USER_B, title: "t", status: "TODO" }],
      ["calendarEvent i B:s ärende", { id: uuidv7(), organizationId: ORG_A, userId: MEMBER_A, matterId: MATTER_B, title: "e", startAt: new Date() }],
      ["serviceNote i B:s ärende", { id: uuidv7(), organizationId: ORG_A, matterId: MATTER_B, authorId: MEMBER_A, date: "2026-10-01", time: "10:00", text: "x" }],
      ["contact med B:s kontakt som förälder", { id: uuidv7(), organizationId: ORG_A, name: "Dotterbolag", parentId: CONTACT_B }],
      ["matterContact som kopplar B:s kontakt", { id: uuidv7(), matterId: MATTER_A, contactId: CONTACT_B, role: "MOTPART" }],
      ["document i B:s mapp", { id: uuidv7(), matterId: MATTER_A, folderId: FOLDER_B, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: SHA_PATH, uploadedById: MEMBER_A }],
      ["documentFolder under B:s mapp", { id: uuidv7(), matterId: MATTER_A, name: "Mapp", parentId: FOLDER_B }],
      ["documentPart av B:s dokument", { id: uuidv7(), matterId: MATTER_A, documentId: DOC_B, ordinal: 0, kind: "OVRIGT", fromPage: 1, toPage: 1, source: "MANUAL" }],
    ];
    for (const [what, row] of cases) {
      const entity = what.split(" ")[0] ?? "";
      it(`${what} → annan byrå`, async () => {
        expect(await sync.push(member, mut(entity, "create", row))).toEqual({ status: "conflict", reason: "annan byrå" });
      });
    }

    it("en egen rad som pekas om till B:s ärende → annan byrå, raden orörd", async () => {
      const id = uuidv7();
      await repos.tasks.create({ id, organizationId: ORG_A, userId: MEMBER_A, matterId: MATTER_A, title: "Egen", status: "TODO" } as never);
      expect(await sync.push(member, mut("task", "update", { id, matterId: MATTER_B }))).toEqual({ status: "conflict", reason: "annan byrå" });
      expect((await repos.tasks.getById(asId<"TaskId">(id)))?.matterId).toBe(MATTER_A);
    });

    it("egna referenser går igenom (kollega i samma byrå, eget ärende)", async () => {
      expect(await sync.push(member, mut("task", "create", { id: uuidv7(), organizationId: ORG_A, userId: ADMIN_A, matterId: MATTER_A, title: "Till admin", status: "TODO" })))
        .toMatchObject({ status: "accepted" });
    });
  });

  describe("vem som skapade raden går inte att förfalska", () => {
    it("en anteckning i en kollegas namn → avvisad; i eget namn → accepterad", async () => {
      const note = { organizationId: ORG_A, matterId: MATTER_A, date: "2026-10-01", time: "10:00", text: "Samtal" };
      expect(await sync.push(member, mut("serviceNote", "create", { id: uuidv7(), ...note, authorId: ADMIN_A })))
        .toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.actor });
      expect(await sync.push(member, mut("serviceNote", "create", { id: uuidv7(), ...note, authorId: MEMBER_A }))).toMatchObject({ status: "accepted" });
    });

    it("en ändring kan inte byta skapare eller skapelsetid", async () => {
      const id = uuidv7();
      const createdAt = new Date("2026-01-01T00:00:00Z");
      await repos.serviceNotes.create({ id, organizationId: ORG_A, matterId: MATTER_A, authorId: MEMBER_A, date: "2026-10-01", time: "10:00", text: "Före", createdAt } as never);
      const res = await sync.push(admin, mut("serviceNote", "update", { id, text: "Efter", authorId: ADMIN_A, createdAt: new Date() }));
      expect(res).toMatchObject({ status: "accepted" });
      expect(await repos.serviceNotes.getById(asId<"ServiceNoteId">(id))).toMatchObject({ text: "Efter", authorId: MEMBER_A, createdAt });
    });

    it("ett dokument laddas upp i eget namn", async () => {
      const doc = { matterId: MATTER_A, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: SHA_PATH };
      expect(await sync.push(member, mut("document", "create", { id: uuidv7(), ...doc, uploadedById: ADMIN_A }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.actor });
      expect(await sync.push(member, mut("document", "create", { id: uuidv7(), ...doc, uploadedById: MEMBER_A }))).toMatchObject({ status: "accepted" });
    });
  });

  /**
   * Sökvägen till innehållet (#1372): content-store:n delas av alla byråer, så
   * en fritt vald sökväg kunde läsa `.git` (alla byråers hashar och innehåll)
   * eller en annan byrås fil.
   */
  describe("sökvägen till dokumentets innehåll", () => {
    const docRow = (id: string, storagePath: string): Record<string, unknown> => ({
      id, matterId: MATTER_A, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath, uploadedById: MEMBER_A,
    });

    it.each([
      [".git-internt", "documents/content/../.git/index"],
      ["utanför katalogen", "../../etc/passwd"],
      ["git-objekt", ".git/objects/ab/cdef"],
      ["undermapp", "documents/content/sub/x.pdf"],
      ["dold fil", "documents/content/.git"],
      ["absolut", "/documents/content/x"],
      ["B:s dokuments fil", `documents/content/${DOC_B}.pdf`],
      ["ett annat namn", "documents/content/doc-pdf-01.pdf"],
    ])("ny rad med %s → avvisad, ingen rad", async (_label, storagePath) => {
      const id = uuidv7();
      expect(await sync.push(member, mut("document", "create", docRow(id, storagePath)))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.contentPath });
      expect(await repos.documents.getById(asId<"DocumentId">(id))).toBeNull();
    });

    it("dokumentets eget innehåll (sha256, pending-<id>, <id>.<ext>) → accepterat", async () => {
      for (const make of [() => SHA_PATH, (id: string) => `documents/content/pending-${id}`, (id: string) => `documents/content/${id}.pdf`]) {
        const id = uuidv7();
        expect(await sync.push(member, mut("document", "create", docRow(id, make(id))))).toMatchObject({ status: "accepted" });
      }
    });

    it("en ändring som pekar om till B:s fil → avvisad; ett namnbyte med en äldre sökväg orörd → accepterat", async () => {
      const id = uuidv7();
      await repos.documents.create({ ...docRow(id, "documents/content/doc-pdf-01.pdf"), organizationId: ORG_A } as never);
      expect(await sync.push(member, mut("document", "update", { id, storagePath: `documents/content/${DOC_B}.pdf` }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.contentPath });
      expect(await sync.push(member, mut("document", "update", { id, fileName: "b.pdf", storagePath: "documents/content/doc-pdf-01.pdf" }))).toMatchObject({ status: "accepted" });
      expect(await repos.documents.getById(asId<"DocumentId">(id))).toMatchObject({ fileName: "b.pdf", storagePath: "documents/content/doc-pdf-01.pdf" });
    });
  });

  describe("användarens egna preferenser", () => {
    it("bara ägaren skriver dem", async () => {
      const id = uuidv7();
      const pref = { id, userId: MEMBER_A, organizationId: ORG_A, key: "list.matters", prefs: { cols: ["title"] } };
      expect(await sync.push(member, mut("userPreference", "create", pref))).toMatchObject({ status: "accepted" });
      expect(await sync.push(admin, mut("userPreference", "update", { id, prefs: {} }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.owner });
      expect(await sync.push(admin, mut("userPreference", "delete", { id }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.owner });
      expect(await sync.push(member, mut("userPreference", "create", { ...pref, id: uuidv7(), userId: ADMIN_A }))).toEqual({ status: "conflict", reason: ROW_POLICY_REASONS.owner });
      expect(await sync.push(member, mut("userPreference", "update", { id, prefs: { cols: [] } }))).toMatchObject({ status: "accepted" });
    });
  });
});
