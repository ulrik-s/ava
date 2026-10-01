/**
 * Ärendets jävskontroll (#1246, #1354).
 *
 * Ärendets parter kontrolleras mot byråns alla andra ärenden när ärendet skapas
 * och när en part läggs till. En träff räknas bara när personen står på andra
 * sidan där (klient här ↔ motpart där, och tvärtom) — en återkommande klient är
 * ingen jävsfråga. Klientens optimistiska körning (offline, `provisional`)
 * avgör ingenting utan lämnar kontrollen som väntande. Servern kör om anropet
 * och avgör.
 */

import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { checkMatterConflicts } from "@/lib/server/conflict/matter-conflict-check";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";

const ORG = "org-1";
const ORG_ID = asId<"OrganizationId">(ORG);
const principal = (role: UserRole): Principal => ({
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role, organizationId: ORG_ID,
});
const OLD = asId<"MatterId">("019a0000-0000-7000-8000-000000000001");
const NEW = asId<"MatterId">("019a0000-0000-7000-8000-000000000002");
/** Motpart i det befintliga ärendet. */
const KLIENT = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c1");
/** Förekommer ingenstans. */
const OTHER = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c2");
/** Klient i det befintliga ärendet. */
const RETURNING = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c4");
/** Vittne i det befintliga ärendet. */
const WITNESS = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c5");
const QUEUED = { mutationId: "019a0000-0000-7000-8000-00000000aaaa", at: Date.UTC(2026, 8, 30, 10) };

/** Byrån: ett befintligt ärende med en klient, en motpart och ett vittne. */
function setup(role: UserRole = "ADMIN") {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "Byrån" }],
    users: [{ id: "u-1", organizationId: ORG, email: "a@x", name: "Anna", role }],
    matters: [{ id: OLD, organizationId: ORG, matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE", createdAt: new Date() }],
    contacts: [
      { id: KLIENT, organizationId: ORG, name: "Bo Berg", contactType: "PERSON", personalNumber: "19800101-1234" },
      { id: OTHER, organizationId: ORG, name: "Cecilia Ek", contactType: "PERSON" },
      { id: RETURNING, organizationId: ORG, name: "Dag Dahl", contactType: "PERSON", personalNumber: "19700101-1111" },
      { id: WITNESS, organizationId: ORG, name: "Gun Grå", contactType: "PERSON", personalNumber: "19600101-2222" },
    ],
    matterContacts: [
      { id: "019a0000-0000-7000-8000-0000000000d1", matterId: OLD, contactId: KLIENT, role: "MOTPART" },
      { id: "019a0000-0000-7000-8000-0000000000d2", matterId: OLD, contactId: RETURNING, role: "KLIENT" },
      { id: "019a0000-0000-7000-8000-0000000000d3", matterId: OLD, contactId: WITNESS, role: "VITTNE" },
    ],
    conflictChecks: [],
    serviceNotes: [],
  }, async () => { /* skrivbart lager */ });
  const ctx = buildContext({ dataStore: ds, ports: noopPorts, principal: principal(role) });
  return { ctx, caller: appRouter.createCaller(ctx) };
}

async function loggedChecks(ctx: ReturnType<typeof setup>["ctx"]) {
  return (await ctx.repos.conflictChecks.listHistory(ORG_ID, 1, 50)).checks;
}

describe("matter.create — jävskontrollen", () => {
  it("klienten är motpart i ett annat ärende → träffar att bedöma, och kontrollen loggas", async () => {
    const { caller, ctx } = setup();
    const matter = await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    expect(matter).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
    expect(matter.conflictCheckedAt).toBeInstanceOf(Date);
    expect((await loggedChecks(ctx)).map((c) => c.searchTerm)).toEqual(["Bo Berg 19800101-1234"]);
  });

  it("återkommande klient (klient i ett annat ärende) → inga träffar, men kontrollen loggas", async () => {
    const { caller, ctx } = setup();
    expect(await caller.matter.create({ id: NEW, title: "Nytt", klientId: RETURNING }))
      .toMatchObject({ conflictCheckStatus: "CLEAR", conflictCheckHits: 0 });
    expect(await loggedChecks(ctx)).toHaveLength(1);
  });

  it("klienten är bara vittne i ett annat ärende → inga träffar", async () => {
    const { caller } = setup();
    expect(await caller.matter.create({ id: NEW, title: "Nytt", klientId: WITNESS })).toMatchObject({ conflictCheckStatus: "CLEAR" });
  });

  it("klienten förekommer inte → inga träffar; ärendets egen klientkoppling räknas inte", async () => {
    const { caller } = setup();
    expect(await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER }))
      .toMatchObject({ conflictCheckStatus: "CLEAR", conflictCheckHits: 0 });
  });

  it("utan klient finns inget att kontrollera → väntar", async () => {
    const { caller } = setup();
    expect(await caller.matter.create({ title: "Nytt" })).toMatchObject({ conflictCheckStatus: "PENDING", conflictCheckHits: null });
  });

  it("klientens optimistiska körning (offline) avgör inget: väntar, och ingen kontroll loggas", async () => {
    const { ctx } = setup();
    const offline = appRouter.createCaller({ ...ctx, queued: QUEUED, provisional: true });
    expect(await offline.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT })).toMatchObject({ conflictCheckStatus: "PENDING" });
    expect(await loggedChecks(ctx)).toHaveLength(0);
  });

  it("serverns körning av samma köade anrop avgör — med kontrollens id härlett ur anropet och parten", async () => {
    const { ctx } = setup();
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    expect(await server.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT })).toMatchObject({ conflictCheckStatus: "HITS" });
    expect((await loggedChecks(ctx)).map((c) => c.id)).toEqual([derivedId(QUEUED.mutationId, `conflictCheck:${KLIENT}:KLIENT`)]);
  });
});

describe("matter.addContact — en ny part kontrolleras", () => {
  it("ny motpart som är klient i ett annat ärende → träffar att bedöma", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await caller.matter.addContact({ matterId: NEW, contactId: RETURNING, role: "MOTPART" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  it("nytt motpartsombud som är klient i ett annat ärende → träffar att bedöma", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await caller.matter.addContact({ matterId: NEW, contactId: RETURNING, role: "MOTPARTSOMBUD" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS" });
  });

  it("ny motpart som är motpart också i det andra ärendet → fortfarande inga träffar; alla parter loggas", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await caller.matter.addContact({ matterId: NEW, contactId: KLIENT, role: "MOTPART" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR", conflictCheckHits: 0 });
    // Skapandet (klienten) + omkontrollen (klienten och motparten).
    expect(await loggedChecks(ctx)).toHaveLength(3);
  });

  it("ett vittne är ingen part → ingen ny kontroll, och kopplingen returneras", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    const link = await caller.matter.addContact({ matterId: NEW, contactId: RETURNING, role: "VITTNE" });
    expect(link).toMatchObject({ matterId: NEW, contactId: RETURNING, role: "VITTNE" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR" });
    expect(await loggedChecks(ctx)).toHaveLength(1);
  });

  it("en motpart i ett ärende utan klient → väntar fortfarande", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    await caller.matter.addContact({ matterId: NEW, contactId: RETURNING, role: "MOTPART" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "PENDING" });
  });

  it("klientens optimistiska körning väntar; serverns körning av samma anrop avgör med samma koppling", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    const id = asId<"MatterContactId">("019a0000-0000-7000-8000-0000000000e1");
    const offline = appRouter.createCaller({ ...ctx, queued: QUEUED, provisional: true });
    await offline.matter.addContact({ id, matterId: NEW, contactId: RETURNING, role: "MOTPART" });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "PENDING" });
    await ctx.repos.matterContacts.hardDelete(id);
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    expect(await server.matter.addContact({ id, matterId: NEW, contactId: RETURNING, role: "MOTPART" })).toMatchObject({ id });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS" });
  });

  it("skapad-datumet är ett setup-fält: aldrig via kön", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    const queued = appRouter.createCaller({ ...ctx, queued: QUEUED });
    await expect(queued.matter.addContact({ matterId: NEW, contactId: OTHER, role: "KLIENT", createdAt: "2025-01-01" }))
      .rejects.toThrow(/sätts av servern/);
  });

  it("admin direkt får backdatera kopplingen (demo-generatorn)", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    const link = await caller.matter.addContact({ matterId: NEW, contactId: OTHER, role: "OVRIG", createdAt: "2025-01-01T00:00:00Z", notes: "x" });
    expect(new Date(link.createdAt).toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("okänd kontakt → NOT_FOUND", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    await expect(caller.matter.addContact({ matterId: NEW, contactId: asId<"ContactId">("019a0000-0000-7000-8000-0000000000ff"), role: "MOTPART" }))
      .rejects.toThrow();
  });
});

describe("matter.addNewContact — en ny part kontrolleras", () => {
  it("ny motpart med samma personnummer som en befintlig klient → kontakten återanvänds och träffar att bedöma", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    const link = await caller.matter.addNewContact({ matterId: NEW, name: "Dag Dahl", contactType: "PERSON", personalNumber: "19700101-1111", role: "MOTPART" });
    expect(link.contactId).toBe(RETURNING);
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS" });
  });

  it("ett nytt bolag (orgnummer) skapas och kontrolleras; i ett köat anrop med id ur anropet", async () => {
    const { ctx, caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    const link = await server.matter.addNewContact({ matterId: NEW, name: "Nytt Bolag AB", contactType: "COMPANY", orgNumber: "559999-0000", role: "MOTPART" });
    expect(link).toMatchObject({ id: derivedId(QUEUED.mutationId, "matterContact"), contactId: derivedId(QUEUED.mutationId, "contact") });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR" });
  });

  it("en ny kontakt utan nummer i en neutral roll → ingen ny kontroll", async () => {
    const { ctx, caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await caller.matter.addNewContact({ matterId: NEW, name: "Tingsrätten", contactType: "COURT", role: "DOMSTOL" });
    expect(await loggedChecks(ctx)).toHaveLength(1);
  });
});

describe("matter.checkConflicts — kör om", () => {
  it("klienten lades till efter att ärendet skapades → kontrollen körs för den", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    await caller.matter.addContact({ matterId: NEW, contactId: KLIENT, role: "KLIENT" });
    expect(await caller.matter.checkConflicts({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  it("fortfarande utan klient → väntar", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt" });
    expect(await caller.matter.checkConflicts({ id: NEW })).toMatchObject({ conflictCheckStatus: "PENDING" });
  });

  it("okänt ärende → NOT_FOUND", async () => {
    const { caller } = setup();
    await expect(caller.matter.checkConflicts({ id: NEW })).rejects.toThrow(/finns inte/);
  });
});

describe("matter.markConflictsReviewed — dokumenterad bedömning", () => {
  it("vem, när och motiveringen sparas — och skrivs som tjänsteanteckning", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    const reviewed = await caller.matter.markConflictsReviewed({ id: NEW, note: "  Annan person, annat ärende.  " });
    expect(reviewed).toMatchObject({ conflictCheckStatus: "REVIEWED", conflictReviewedById: "u-1", conflictReviewNote: "Annan person, annat ärende." });
    expect(reviewed.conflictReviewedAt).toBeInstanceOf(Date);
    const notes = await ctx.repos.serviceNotes.listByMatter(NEW, ORG_ID);
    expect(notes.map((n) => n.text)).toEqual(["Jävskontrollens träffar bedömda: Annan person, annat ärende."]);
  });

  it("i ett köat anrop är tidpunkten när anropet gjordes", async () => {
    const { caller, ctx } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    const reviewed = await server.matter.markConflictsReviewed({ id: NEW, note: "Bedömt." });
    expect(new Date(reviewed.conflictReviewedAt ?? 0).getTime()).toBe(QUEUED.at);
  });

  it("en advokat får bedöma", async () => {
    const { caller } = setup("LAWYER");
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    expect(await caller.matter.markConflictsReviewed({ id: NEW, note: "Ok." })).toMatchObject({ conflictCheckStatus: "REVIEWED" });
  });

  it("en assistent får inte bedöma", async () => {
    const { caller } = setup("ASSISTANT");
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    await expect(caller.matter.markConflictsReviewed({ id: NEW, note: "Ok." })).rejects.toThrow(/advokat eller admin/);
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS" });
  });

  it("motiveringen krävs", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: KLIENT });
    await expect(caller.matter.markConflictsReviewed({ id: NEW, note: "   " })).rejects.toThrow(/Motivera/);
  });

  it("utan träffar finns inget att bedöma", async () => {
    const { caller } = setup();
    await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER });
    await expect(caller.matter.markConflictsReviewed({ id: NEW, note: "Ok." })).rejects.toThrow(/inga träffar/);
  });

  it("okänt ärende → NOT_FOUND", async () => {
    const { caller } = setup();
    await expect(caller.matter.markConflictsReviewed({ id: NEW, note: "Ok." })).rejects.toThrow(/finns inte/);
  });
});

describe("checkMatterConflicts", () => {
  it("en klient som inte finns (t.ex. raderad) → väntar", async () => {
    const { ctx } = setup();
    const missing = asId<"ContactId">("019a0000-0000-7000-8000-0000000000ff");
    expect(await checkMatterConflicts({ ...ctx, user: principal("ADMIN") }, NEW, [{ contactId: missing, role: "KLIENT" }]))
      .toMatchObject({ conflictCheckStatus: "PENDING" });
  });

  it("klient med bara organisationsnummer söks på det", async () => {
    const { ctx } = setup();
    const berg = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c3");
    await ctx.repos.contacts.create({ id: berg, organizationId: ORG_ID, name: "Berg AB", contactType: "COMPANY", orgNumber: "556000-1111" });
    await checkMatterConflicts({ ...ctx, user: principal("ADMIN") }, NEW, [{ contactId: berg, role: "KLIENT" }]);
    expect((await loggedChecks(ctx))[0]?.searchTerm).toBe("Berg AB 556000-1111");
  });

  it("samma part två gånger kontrolleras en gång; neutrala parter inte alls", async () => {
    const { ctx } = setup();
    const parties = [
      { contactId: KLIENT, role: "KLIENT" as const }, { contactId: KLIENT, role: "KLIENT" as const },
      { contactId: WITNESS, role: "VITTNE" as const },
    ];
    expect(await checkMatterConflicts({ ...ctx, user: principal("ADMIN") }, NEW, parties)).toMatchObject({ conflictCheckHits: 1 });
    expect(await loggedChecks(ctx)).toHaveLength(1);
  });
});
