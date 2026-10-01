/**
 * Jävskontrollen i procedur-kön (#1246), mot Postgres.
 *
 * Ett ärende som skapas offline har bara klientens lokala kopia att kontrollera
 * mot, och klientens körning lämnar kontrollen som väntande. När anropet når
 * servern körs det om mot byråns alla ärenden — här: klienten är motpart i ett
 * ärende som den offline-klienten aldrig sett.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">(uuidv7());
const USER = uuidv7();
const KLIENT = asId<"ContactId">(uuidv7());
/** Klient i ett befintligt ärende — blir motpart i ett nytt. */
const RETURNING = asId<"ContactId">(uuidv7());

describe("jävskontrollen körs av servern när det köade anropet når den (#1246)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    await handle.db.insert(users).values({ id: asId<"UserId">(USER), organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 });
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: ORG },
    });
    // Ett befintligt ärende där den blivande klienten är motpart.
    const old = asId<"MatterId">(uuidv7());
    await repos.matters.create({ id: old, organizationId: ORG, title: "Tvist", status: "ACTIVE", matterNumber: "2026-0001" });
    await repos.contacts.create({ id: KLIENT, organizationId: ORG, name: "Bo Berg", contactType: "PERSON", personalNumber: "19800101-1234" });
    await repos.matterContacts.create({ id: asId<"MatterContactId">(uuidv7()), matterId: old, contactId: KLIENT, role: "MOTPART" });
    await repos.contacts.create({ id: RETURNING, organizationId: ORG, name: "Dag Dahl", contactType: "PERSON", personalNumber: "19700101-1111" });
    await repos.matterContacts.create({ id: asId<"MatterContactId">(uuidv7()), matterId: old, contactId: RETURNING, role: "KLIENT" });
  });
  afterAll(async () => { await handle.close(); });

  const call = (path: string, input: Record<string, unknown>): QueuedProcedureCall => ({
    type: "procedure", mutationId: uuidv7(), path, input, codeVersion: "test", enqueuedAt: Date.now(), touches: [],
  });

  it("jävskontrollens anrop köas", () => {
    expect(isQueuedProcedure("matter.checkConflicts") && isQueuedProcedure("matter.markConflictsReviewed")).toBe(true);
    expect(isQueuedProcedure("matter.addContact") && isQueuedProcedure("matter.addNewContact")).toBe(true);
  });

  it("ärendet skapat offline får serverns resultat: träffar att bedöma, loggat med anropets id", async () => {
    const id = asId<"MatterId">(uuidv7());
    const c = call("matter.create", { id, title: "Nytt uppdrag", klientId: KLIENT });
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "accepted" });
    expect(await repos.matters.getByIdInOrg(id, ORG)).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
    const { checks } = await repos.conflictChecks.listHistory(ORG, 1, 50);
    expect(checks.map((x) => x.id)).toContain(derivedId(c.mutationId, `conflictCheck:${KLIENT}:KLIENT`));
  });

  it("bedömningen går också via kön — med granskaren, när anropet gjordes och motiveringen", async () => {
    const id = asId<"MatterId">(uuidv7());
    await replayer.replay(call("matter.create", { id, title: "Annat uppdrag", klientId: KLIENT }), ctx);
    const review = call("matter.markConflictsReviewed", { id, note: "Annan person med samma namn." });
    expect(await replayer.replay(review, ctx)).toMatchObject({ status: "accepted" });
    const matter = await repos.matters.getByIdInOrg(id, ORG);
    expect(matter).toMatchObject({ conflictCheckStatus: "REVIEWED", conflictReviewedById: USER, conflictReviewNote: "Annan person med samma namn." });
    expect(new Date(matter?.conflictReviewedAt ?? 0).getTime()).toBe(review.enqueuedAt);
  });

  it("en ny motpart som är klient i ett annat ärende: servern kör om kopplingen och kontrollen", async () => {
    const id = asId<"MatterId">(uuidv7());
    const other = asId<"ContactId">(uuidv7());
    await repos.contacts.create({ id: other, organizationId: ORG, name: "Ny Klient", contactType: "PERSON" });
    await replayer.replay(call("matter.create", { id, title: "Tredje uppdraget", klientId: other }), ctx);
    expect(await repos.matters.getByIdInOrg(id, ORG)).toMatchObject({ conflictCheckStatus: "CLEAR" });
    const link = asId<"MatterContactId">(uuidv7());
    const add = call("matter.addContact", { id: link, matterId: id, contactId: RETURNING, role: "MOTPART" });
    expect(await replayer.replay(add, ctx)).toMatchObject({ status: "accepted" });
    expect(await repos.matterContacts.getByIdInOrg(link, ORG)).toMatchObject({ contactId: RETURNING, role: "MOTPART" });
    expect(await repos.matters.getByIdInOrg(id, ORG)).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });

  // #1383: ett accepterat dokumentförslag kopplar också en part — samma kontroll.
  it("ett accepterat dokumentförslag: servern kör om kopplingen och kontrollen", async () => {
    expect(isQueuedProcedure("document.acceptSuggestion") && isQueuedProcedure("document.acceptSuggestionGroup")).toBe(true);
    const id = asId<"MatterId">(uuidv7());
    const other = asId<"ContactId">(uuidv7());
    await repos.contacts.create({ id: other, organizationId: ORG, name: "Fjärde Klienten", contactType: "PERSON" });
    await replayer.replay(call("matter.create", { id, title: "Fjärde uppdraget", klientId: other }), ctx);
    expect(await repos.matters.getByIdInOrg(id, ORG)).toMatchObject({ conflictCheckStatus: "CLEAR" });
    const doc = asId<"DocumentId">(uuidv7());
    await repos.documents.create({ id: doc, matterId: id, fileName: "stamning.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${doc}`, uploadedById: USER } as never);
    const sugg = asId<"DocumentAnalysisSuggestionId">(uuidv7());
    await repos.documentAnalysisSuggestions.create({
      id: sugg, documentId: doc, name: "Dag Dahl", role: "MOTPART", contactType: "PERSON", personalNumber: "19700101-1111", status: "PENDING",
    } as never);
    const accept = call("document.acceptSuggestion", { suggestionId: sugg });
    expect(await replayer.replay(accept, ctx)).toMatchObject({ status: "accepted" });
    const link = await repos.matterContacts.findLink(id, RETURNING, "MOTPART");
    expect(link?.id).toBe(derivedId(accept.mutationId, "matterContact:MOTPART"));
    expect(await repos.matters.getByIdInOrg(id, ORG)).toMatchObject({ conflictCheckStatus: "HITS", conflictCheckHits: 1 });
  });
});
