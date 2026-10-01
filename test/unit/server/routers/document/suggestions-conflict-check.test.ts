/**
 * Jävskontrollen när ett dokumentförslag accepteras (#1383).
 *
 * `matter.addContact`/`addNewContact` kör om kontrollen när en klient, motpart
 * eller ett motpartsombud kopplas till ärendet (#1354). Ett accepterat förslag
 * kopplar också en part — samma kontroll, och samma väg: anropet köas och
 * servern kör om det mot byråns alla ärenden. Klientens optimistiska körning
 * (`provisional`) lämnar kontrollen som väntande; raderna får id ur anropet.
 */

import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import type { MatterRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";

const ORG = "org-1";
const ORG_ID = asId<"OrganizationId">(ORG);
const OLD = asId<"MatterId">("019a0000-0000-7000-8000-000000000001");
const NEW = asId<"MatterId">("019a0000-0000-7000-8000-000000000002");
const DOC = asId<"DocumentId">("019a0000-0000-7000-8000-0000000000f1");
/** Klient i det befintliga ärendet. */
const RETURNING = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c4");
/** Klient i det nya ärendet — förekommer ingen annanstans. */
const OTHER = asId<"ContactId">("019a0000-0000-7000-8000-0000000000c2");
const QUEUED = { mutationId: "019a0000-0000-7000-8000-00000000aaaa", at: Date.UTC(2026, 8, 30, 10) };

/** Ett förslag i det nya ärendets dokument: Dag Dahl (klient i det gamla ärendet). */
const suggestion = (id: string, role: MatterRole) => ({
  id, documentId: DOC, name: "Dag Dahl", role, contactType: "PERSON", personalNumber: "19700101-1111",
  email: null, phone: null, orgNumber: null, notes: null, status: "PENDING", acceptedContactId: null,
  createdAt: new Date("2026-09-01"),
});

/** Byrån: ett befintligt ärende där Dag Dahl är klient, och ett nytt ärende med ett dokument. */
function setup(roles: readonly MatterRole[] = ["MOTPART"], withReturning = true) {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "Byrån" }],
    users: [{ id: "u-1", organizationId: ORG, email: "a@x", name: "Anna", role: "LAWYER" }],
    matters: [{ id: OLD, organizationId: ORG, matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE", createdAt: new Date() }],
    contacts: [
      { id: OTHER, organizationId: ORG, name: "Cecilia Ek", contactType: "PERSON" },
      ...(withReturning ? [{ id: RETURNING, organizationId: ORG, name: "Dag Dahl", contactType: "PERSON", personalNumber: "19700101-1111" }] : []),
    ],
    matterContacts: withReturning ? [{ id: "019a0000-0000-7000-8000-0000000000d2", matterId: OLD, contactId: RETURNING, role: "KLIENT" }] : [],
    documents: [{ id: DOC, matterId: NEW, fileName: "stamning.pdf", title: "Stämning" }],
    documentAnalysisSuggestions: roles.map((role, i) => suggestion(`019a0000-0000-7000-8000-00000000b00${i}`, role)),
    conflictChecks: [],
    serviceNotes: [],
  }, async () => { /* skrivbart lager */ });
  const ctx = buildContext({
    dataStore: ds, ports: noopPorts,
    principal: { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "LAWYER", organizationId: ORG_ID },
  });
  return { ctx, caller: appRouter.createCaller(ctx) };
}

const SUGG = (i: number) => asId<"DocumentAnalysisSuggestionId">(`019a0000-0000-7000-8000-00000000b00${i}`);

/** Det nya ärendet, kontrollerat utan träffar (klienten förekommer inte annanstans). */
async function newMatter(caller: ReturnType<typeof setup>["caller"]) {
  expect(await caller.matter.create({ id: NEW, title: "Nytt", klientId: OTHER })).toMatchObject({ conflictCheckStatus: "CLEAR" });
}

describe("dokumentförslagen köas som anrop (#1383)", () => {
  it("acceptansen — enskild och i grupp — körs om av servern", () => {
    expect(isQueuedProcedure("document.acceptSuggestion")).toBe(true);
    expect(isQueuedProcedure("document.acceptSuggestionGroup")).toBe(true);
  });
});

describe("document.acceptSuggestion — en ny part kontrolleras", () => {
  it("motpart som är klient i ett annat ärende → träffar att bedöma", async () => {
    const { caller } = setup();
    await newMatter(caller);
    expect(await caller.document.acceptSuggestion({ suggestionId: SUGG(0) })).toEqual({ contactId: RETURNING });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  it("rollen ur användarens ändring gäller: vittne är ingen part → ingen ny kontroll", async () => {
    const { caller, ctx } = setup();
    await newMatter(caller);
    const before = (await ctx.repos.conflictChecks.listHistory(ORG_ID, 1, 50)).checks.length;
    await caller.document.acceptSuggestion({ suggestionId: SUGG(0), override: { role: "VITTNE" } });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR" });
    expect((await ctx.repos.conflictChecks.listHistory(ORG_ID, 1, 50)).checks).toHaveLength(before);
  });

  it("klientens optimistiska körning väntar; serverns körning av samma anrop avgör med samma rader", async () => {
    const { caller, ctx } = setup(["MOTPART"], false);
    await newMatter(caller);
    const offline = appRouter.createCaller({ ...ctx, queued: QUEUED, provisional: true });
    const created = await offline.document.acceptSuggestion({ suggestionId: SUGG(0) });
    expect(created.contactId).toBe(derivedId(QUEUED.mutationId, "contact"));
    const link = await ctx.repos.matterContacts.findLink(NEW, created.contactId, "MOTPART");
    expect(link?.id).toBe(derivedId(QUEUED.mutationId, "matterContact:MOTPART"));
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "PENDING" });
  });
});

describe("document.acceptSuggestionGroup — en ny part kontrolleras", () => {
  it("motpart och vittne i samma grupp → kontrollen körs, träff på motparten", async () => {
    const { caller } = setup(["MOTPART", "VITTNE"]);
    await newMatter(caller);
    const res = await caller.document.acceptSuggestionGroup({ suggestionIds: [SUGG(0), SUGG(1)] });
    expect(res).toEqual({ contactId: RETURNING, acceptedRoles: ["MOTPART", "VITTNE"] });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  it("bara neutrala roller → ingen ny kontroll", async () => {
    const { caller } = setup(["VITTNE"]);
    await newMatter(caller);
    await caller.document.acceptSuggestionGroup({ suggestionIds: [SUGG(0)] });
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR" });
  });

  it("i serverns körning får kontakten och varje rollkoppling id ur anropet", async () => {
    const { caller, ctx } = setup(["MOTPART", "VITTNE"], false);
    await newMatter(caller);
    const server = appRouter.createCaller({ ...ctx, queued: QUEUED });
    const res = await server.document.acceptSuggestionGroup({ suggestionIds: [SUGG(0), SUGG(1)] });
    const contactId = asId<"ContactId">(derivedId(QUEUED.mutationId, "contact"));
    expect(res.contactId).toBe(contactId);
    expect((await ctx.repos.matterContacts.findLink(NEW, contactId, "VITTNE"))?.id).toBe(derivedId(QUEUED.mutationId, "matterContact:VITTNE"));
    // Ny kontakt som inte förekommer i andra ärenden → kontrollen kördes, utan träffar.
    expect(await caller.matter.getById({ id: NEW })).toMatchObject({ conflictCheckStatus: "CLEAR", conflictCheckHits: 0 });
  });
});
