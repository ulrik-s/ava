/**
 * Administrationen från webbläsaren (#1344) — klienten byggd som i appen
 * (`createServerFirstStore`, routrarna in-process, procedurkön) mot servern
 * bakom den riktiga tRPC-handlern.
 *
 * Inställnings- och användarvyerna fungerar som förut: anropet körs lokalt
 * (fungerar offline) och köas som ANROP, inte som rader. Servern kör om det med
 * rollen ur databasen. En manipulerad klient som köar en färdig användarrad
 * får en avvisning som syns i vyn för avvisade ändringar.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { isProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { asId } from "@/lib/shared/schemas/ids";
import { PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";
import { ORG, SimClient, SimServer, userFor } from "./simulation/sync-world";

const ADMIN = asId<"UserId">(userFor(0).id);
const MEMBER = asId<"UserId">(userFor(1).id);

describe("administrationen från webbläsaren (#1344)", () => {
  let server: SimServer;
  let admin: SimClient;
  let member: SimClient;
  const prevIdb = Reflect.get(globalThis, "indexedDB");

  beforeAll(async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    server = await SimServer.start(2);
    await server.repos.organizations.create({ id: ORG, name: "Simbyrån", bankgiro: "111-1111" } as never);
    await server.repos.users.update(ADMIN, { role: "ADMIN" });
    admin = new SimClient(0, server, "ADMIN");
    member = new SimClient(1, server);
    await admin.boot();
    await member.boot();
    expect(await admin.sync()).toBe("ok");
    expect(await member.sync()).toBe("ok");
  });
  afterAll(async () => {
    Reflect.set(globalThis, "indexedDB", prevIdb);
    await server.handle.close();
  });

  it("admin ändrar en kollegas uppgifter: köas som anrop, servern kör om det", async () => {
    await admin.api.user.update.mutate({ id: MEMBER, title: "Delägare" });
    const queued = admin.store.pendingEntries();
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every(isProcedureCall)).toBe(true);
    expect(await admin.sync()).toBe("ok");
    expect((await server.repos.users.getById(MEMBER))?.title).toBe("Delägare");
    expect(admin.rejected.list()).toEqual([]);
  });

  it("admin ändrar bankgiro: servern tar emot det via omkörningen", async () => {
    await admin.api.organization.updateSettings.mutate({ bankgiro: "222-2222" });
    expect(admin.store.pendingEntries().every(isProcedureCall)).toBe(true);
    expect(await admin.sync()).toBe("ok");
    expect((await server.repos.organizations.getById(asId<"OrganizationId">(ORG)))?.bankgiro).toBe("222-2222");
  });

  it("medlem: appen nekar rollbytet redan lokalt", async () => {
    await expect(member.api.user.update.mutate({ id: MEMBER, role: "ADMIN" })).rejects.toThrow(/administratörer/);
    expect(member.store.pendingEntries()).toEqual([]);
  });

  it("medlem med manipulerad klient: en färdig användarrad med ADMIN avvisas och syns som avvisad", async () => {
    await member.store.store.users.update({ where: { id: MEMBER }, data: { role: "ADMIN" } as never });
    expect(member.store.pendingEntries().some((e) => !isProcedureCall(e) && e.entity === "user")).toBe(true);
    expect(await member.sync()).toBe("ok");
    expect((await server.repos.users.getById(MEMBER))?.role).toBe("LAWYER");
    expect(member.rejected.list().map((r) => r.reason)).toContain(PROCEDURE_OWNED_REASON);
  });
});
