/**
 * Administrationen i procedurkön (#1344), mot Postgres.
 *
 * Användare, byråinställningar, kontor, byråns standardvyer och mallar tas
 * inte längre emot som rader. Klienten köar anropet, och servern kör om
 * routern som den inloggade — med rollen ur databasen. En medlem som köar
 * "gör mig till admin" får en avvisning; en admin får igenom samma anrop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { appRouter } from "@/lib/server/routers/_app";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">(uuidv7());
const ORG_B = asId<"OrganizationId">(uuidv7());
const ADMIN = asId<"UserId">(uuidv7());
const MEMBER = asId<"UserId">(uuidv7());
const USER_B = asId<"UserId">(uuidv7());

const ADMIN_PATHS = [
  "user.create", "user.update", "user.deactivate", "user.delete",
  "organization.updateSettings", "organization.addOffice", "organization.updateOffice", "organization.deleteOffice",
  "documentTemplate.create", "documentTemplate.update", "documentTemplate.delete",
  "prefs.setOrgDefault", "prefs.clearOrgDefault",
];

describe("administrationen körs om av servern (#1344)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let asAdmin: Context;
  let asMember: Context;

  const principal = (id: string, role: Principal["role"]): Principal => ({ id: asId<"UserId">(id), email: `${id}@a.se`, name: role, role, organizationId: ORG });
  const ctxFor = (p: Principal): Context => buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal: p });
  const call = (path: string, input: Record<string, unknown>): QueuedProcedureCall => ({
    type: "procedure", mutationId: uuidv7(), path, input, codeVersion: "test", enqueuedAt: Date.now(), touches: [],
  });

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    await repos.organizations.create({ id: ORG, name: "Byrån", bankgiro: "111-1111", orgNumber: "556000-0001" } as never);
    await repos.users.create({ id: ADMIN, organizationId: ORG, email: "admin@a.se", name: "Admin", role: "ADMIN", active: true } as never);
    await repos.users.create({ id: MEMBER, organizationId: ORG, email: "medlem@a.se", name: "Medlem", role: "LAWYER", active: true } as never);
    await repos.users.create({ id: USER_B, organizationId: ORG_B, email: "b@b.se", name: "B", role: "LAWYER", active: true } as never);
    asAdmin = ctxFor(principal(ADMIN, "ADMIN"));
    asMember = ctxFor(principal(MEMBER, "LAWYER"));
  });
  afterAll(async () => { await handle.close(); });

  it("administrationens anrop köas", () => {
    expect(ADMIN_PATHS.filter((p) => !isQueuedProcedure(p))).toEqual([]);
  });

  describe("användare", () => {
    it("medlem: gör mig till admin → avvisad (FORBIDDEN), rollen orörd", async () => {
      expect(await replayer.replay(call("user.update", { id: MEMBER, role: "ADMIN" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect((await repos.users.getById(MEMBER))?.role).toBe("LAWYER");
    });

    it("medlem: skapa användare eller ändra en kollega → avvisad", async () => {
      expect(await replayer.replay(call("user.create", { id: uuidv7(), email: "ny@a.se", name: "Ny", role: "ADMIN" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("user.update", { id: ADMIN, name: "Kapad" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("user.deactivate", { id: ADMIN }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    });

    it("medlem: byt sin egen e-post (inloggningens identitet) → avvisad, adressen orörd (#1371)", async () => {
      expect(await replayer.replay(call("user.update", { id: MEMBER, email: "kapad@annan.se" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect((await repos.users.getById(MEMBER))?.email).toBe("medlem@a.se");
    });

    it("admin: byt en kollegas e-post → accepterad (#1371)", async () => {
      expect(await replayer.replay(call("user.update", { id: MEMBER, email: "medlem.ny@a.se" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect((await repos.users.getById(MEMBER))?.email).toBe("medlem.ny@a.se");
      expect(await replayer.replay(call("user.update", { id: MEMBER, email: "medlem@a.se" }), asAdmin)).toMatchObject({ status: "accepted" });
    });

    it("medlem: ändra sitt eget namn → accepterad", async () => {
      expect(await replayer.replay(call("user.update", { id: MEMBER, name: "Medlem Ny" }), asMember)).toMatchObject({ status: "accepted" });
      expect((await repos.users.getById(MEMBER))?.name).toBe("Medlem Ny");
    });

    it("admin: skapa användare med klientens id, ändra roll och inaktivera → accepterade", async () => {
      const id = asId<"UserId">(uuidv7());
      expect(await replayer.replay(call("user.create", { id, email: "ny@a.se", name: "Ny", role: "LAWYER" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.users.getById(id)).toMatchObject({ organizationId: ORG, role: "LAWYER" });
      expect(await replayer.replay(call("user.update", { id, role: "ADMIN" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await replayer.replay(call("user.deactivate", { id }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.users.getById(id)).toMatchObject({ role: "ADMIN", active: false });
    });

    it("admin: en annan byrås användare → avvisad (NOT_FOUND)", async () => {
      expect(await replayer.replay(call("user.update", { id: USER_B, role: "ADMIN" }), asAdmin)).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    });
  });

  describe("byråinställningar", () => {
    it("medlem: byte av bankgiro eller organisationsnummer → avvisat", async () => {
      expect(await replayer.replay(call("organization.updateSettings", { bankgiro: "999-9999" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("organization.updateSettings", { orgNumber: "556999-9999" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.organizations.getById(ORG)).toMatchObject({ bankgiro: "111-1111", orgNumber: "556000-0001" });
    });

    it.each([
      ["byrånamnet", { name: "Kapad AB" }],
      ["adressen", { address: "Annan väg 2" }],
      ["webbplatsen", { website: "https://kapad.se" }],
      ["timpriserna", { hourlyRates: { ARBETE: 1 } }],
    ])("medlem: byte av %s → avvisat (#1370)", async (_label, patch) => {
      expect(await replayer.replay(call("organization.updateSettings", patch), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.organizations.getById(ORG)).toMatchObject({ name: "Byrån" });
    });

    it("medlem: kontor läggs inte till, ändras inte och tas inte bort (#1370)", async () => {
      const before = (await repos.offices.listByOrg(ORG)).length;
      expect(await replayer.replay(call("organization.addOffice", { name: "Filial" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.offices.listByOrg(ORG)).toHaveLength(before);
      const id = asId<"OfficeId">(uuidv7());
      await repos.offices.create({ id, organizationId: ORG, name: "Filial", isMain: false } as never);
      expect(await replayer.replay(call("organization.updateOffice", { id, name: "Kapad" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("organization.deleteOffice", { id }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect((await repos.offices.getById(id))?.name).toBe("Filial");
    });

    it("medlem: övriga inställningar med oförändrat bankgiro → accepterade", async () => {
      const res = await replayer.replay(call("organization.updateSettings", { documentTags: ["Avtal"], bankgiro: "111-1111" }), asMember);
      expect(res).toMatchObject({ status: "accepted" });
      expect((await repos.organizations.getById(ORG))?.documentTags).toEqual(["Avtal"]);
    });

    it("admin: byte av bankgiro → accepterat", async () => {
      expect(await replayer.replay(call("organization.updateSettings", { bankgiro: "222-2222" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect((await repos.organizations.getById(ORG))?.bankgiro).toBe("222-2222");
    });

    it("kontor: läggs till med id härlett ur anropet, ändras och tas bort", async () => {
      const add = call("organization.addOffice", { name: "Filial" });
      const id = asId<"OfficeId">(derivedId(add.mutationId, "office"));
      expect(await replayer.replay(add, asAdmin)).toMatchObject({ status: "accepted" });
      expect(await replayer.replay(call("organization.updateOffice", { id, name: "Filialen" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect((await repos.offices.getById(id))?.name).toBe("Filialen");
      expect(await replayer.replay(call("organization.deleteOffice", { id }), asAdmin)).toMatchObject({ status: "accepted", rows: [] });
      expect(await repos.offices.getById(id)).toBeNull();
    });

    it("kontor med ett klientvalt id → avvisat i kön, även för admin (#1362)", async () => {
      const id = asId<"OfficeId">(uuidv7());
      expect(await replayer.replay(call("organization.addOffice", { id, name: "Filial" }), asAdmin)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.offices.getById(id)).toBeNull();
    });
  });

  describe("byråns standardvyer och mallar", () => {
    it("standardvy: medlem avvisas; admin får raden med id härlett ur anropet", async () => {
      expect(await replayer.replay(call("prefs.setOrgDefault", { key: "list.matters", prefs: {} }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      const c = call("prefs.setOrgDefault", { key: "list.matters", prefs: { cols: ["title"] } });
      expect(await replayer.replay(c, asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.orgPreferences.getByOrgKey(ORG, "list.matters")).toMatchObject({ id: derivedId(c.mutationId, "orgPreference") });
      expect(await replayer.replay(call("prefs.clearOrgDefault", { key: "list.matters" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.orgPreferences.getByOrgKey(ORG, "list.matters")).toBeNull();
    });

    it("mall: admin skapar med klientens id, ändrar och tar bort", async () => {
      const id = asId<"DocumentTemplateId">(uuidv7());
      expect(await replayer.replay(call("documentTemplate.create", { id, name: "Fullmakt", content: "…" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.documentTemplates.getById(id)).toMatchObject({ organizationId: ORG, createdById: ADMIN });
      expect(await replayer.replay(call("documentTemplate.update", { id, name: "Fullmakt v2" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await replayer.replay(call("documentTemplate.delete", { id }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await repos.documentTemplates.getById(id)).toBeNull();
    });

    it("mall: medlem skapar, ändrar och tar inte bort (#1370)", async () => {
      const id = asId<"DocumentTemplateId">(uuidv7());
      expect(await replayer.replay(call("documentTemplate.create", { id, name: "Fullmakt", content: "…" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.documentTemplates.getById(id)).toBeNull();
      expect(await replayer.replay(call("documentTemplate.create", { id, name: "Fullmakt", content: "…" }), asAdmin)).toMatchObject({ status: "accepted" });
      expect(await replayer.replay(call("documentTemplate.update", { id, name: "Kapad" }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("documentTemplate.delete", { id }), asMember)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect((await repos.documentTemplates.getById(id))?.name).toBe("Fullmakt");
    });

    it("mall i en kollegas namn eller med historiskt datum → avvisad i kön, även för admin (#1345)", async () => {
      const base = { id: uuidv7(), name: "Fullmakt", content: "…" };
      expect(await replayer.replay(call("documentTemplate.create", { ...base, createdById: MEMBER }), asAdmin)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("documentTemplate.create", { ...base, createdAt: "2020-01-01" }), asAdmin)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await replayer.replay(call("documentTemplate.create", { ...base, createdById: ADMIN }), asAdmin)).toMatchObject({ status: "accepted" });
    });

    it("mall: setup-fälten direkt (utan kö) bara för admin", async () => {
      const input = { id: asId<"DocumentTemplateId">(uuidv7()), name: "Seedad", content: "…", createdById: MEMBER, createdAt: "2020-01-01" };
      await expect(appRouter.createCaller(asMember).documentTemplate.create(input)).rejects.toThrow(/Endast administratörer/);
      expect(await appRouter.createCaller(asAdmin).documentTemplate.create(input)).toMatchObject({ createdById: MEMBER });
    });
  });
});
