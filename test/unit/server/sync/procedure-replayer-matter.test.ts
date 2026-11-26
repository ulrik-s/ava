/**
 * Ärendena i procedur-kön (#1242, steg 3) — servern kör om skapandet och
 * ändringarna.
 *
 * Det som skyddas:
 *   - ärendet får klientens id, och standardmapparna och klientkopplingen får
 *     id härledda ur anropet — samma rader i båda körningarna,
 *   - ärendenumret tilldelas i serverns serie, för året då anropet gjordes,
 *   - en ändring skriver bara de fält den bär: två ändringar av olika fält
 *     går inte förlorade,
 *   - en ändring som skriver två anteckningar får två (inte en krock),
 *   - en borttagen part (#1883) tas bort när servern kör om anropet, men
 *     bara i den egna byrån.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { QueuedProcedureCall } from "@/lib/client/local-store/mutation-queue";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { matterContacts, serviceNotes, users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { QUEUE_POLICY } from "@/lib/shared/sync/queue-format";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const USER = uuidv7();
/** Anropet gjordes på nyårsafton 2025 — servern kör om det i januari 2026. */
const MADE_AT = Date.UTC(2025, 11, 31, 10, 0);
/** Servern kör om anropet tre dagar senare — inom gränsen för anropstiden (#1350). */
const REPLAYED_AT = MADE_AT + 3 * 86_400_000;

describe("ärendena i procedur-kön (#1242, steg 3)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos, QUEUE_POLICY, () => REPLAYED_AT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path, input, codeVersion: "test", enqueuedAt: MADE_AT, touches: [] };
  }
  async function accepted(c: QueuedProcedureCall): Promise<void> {
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "accepted" });
  }
  async function createMatter(extra: Record<string, unknown> = {}): Promise<{ id: string; c: QueuedProcedureCall }> {
    const id = uuidv7();
    const c = call("matter.create", { id, title: "Nytt ärende", ...extra });
    await accepted(c);
    return { id, c };
  }

  it("skapande och ändring av ärenden köas som anrop", () => {
    expect(isQueuedProcedure("matter.create")).toBe(true);
    expect(isQueuedProcedure("matter.update")).toBe(true);
  });

  it("create: klientens id, serverns nummer i anropets år, och mapparna får härledda id", async () => {
    const { id, c } = await createMatter();
    const matter = await repos.matters.getById(asId<"MatterId">(id));
    expect(matter).toMatchObject({ id, title: "Nytt ärende", status: "ACTIVE", matterNumber: expect.stringMatching(/2025-\d{4}$/) });
    const folders = await repos.documentFolders.listByMatter(asId<"MatterId">(id));
    expect(folders.length).toBeGreaterThan(0);
    for (const f of folders) {
      const key = `folder:${f.parentId ?? ""}\u0000${f.name.toLocaleLowerCase("sv")}`;
      expect(f.id).toBe(derivedId(c.mutationId, key));
    }
  });

  it("create med klient: kopplingen får härlett id", async () => {
    const klientId = uuidv7();
    await repos.contacts.create({ id: klientId, organizationId: ORG, name: "Klienten", contactType: "PERSON" } as never);
    const { id, c } = await createMatter({ klientId });
    const links = (await handle.db.select().from(matterContacts)).filter((r) => r.matterId === id);
    expect(links).toMatchObject([{ id: derivedId(c.mutationId, "klient"), contactId: klientId, role: "KLIENT" }]);
  });

  it("update: bara de fält ändringen bär skrivs — två ändringar av olika fält går inte förlorade", async () => {
    const { id } = await createMatter();
    await accepted(call("matter.update", { id, title: "Ny titel" }));
    await accepted(call("matter.update", { id, status: "CLOSED" }));
    expect(await repos.matters.getById(asId<"MatterId">(id))).toMatchObject({ title: "Ny titel", status: "CLOSED" });
  });

  it("update som skriver två anteckningar: båda sparas, med var sitt härlett id", async () => {
    const { id } = await createMatter();
    const c = call("matter.update", { id, paymentMethod: "RATTSSKYDD", rattsskyddNekadAt: "2025-12-30" });
    await accepted(c);
    const notes = (await handle.db.select().from(serviceNotes)).filter((r) => r.matterId === id).map((n) => n.id).sort();
    expect(notes).toEqual([derivedId(c.mutationId, "serviceNote"), derivedId(c.mutationId, "serviceNote:2")].sort());
  });

  it("en annan byrås ärende: ändringen avvisas", async () => {
    const foreign = uuidv7();
    await repos.matters.create({ id: foreign, organizationId: uuidv7(), title: "Annan byrå", status: "ACTIVE", matterNumber: "2025-9999" } as never);
    expect(await replayer.replay(call("matter.update", { id: foreign, title: "Kapad" }), ctx)).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  });

  it("removeContact köas och tar bort kopplingen när anropet körs om (#1883)", async () => {
    expect(isQueuedProcedure("matter.removeContact")).toBe(true);
    const contactId = uuidv7();
    await repos.contacts.create({ id: contactId, organizationId: ORG, name: "Motparten", contactType: "PERSON" } as never);
    const { id } = await createMatter();
    const link = await repos.matterContacts.linkContact({
      id: asId<"MatterContactId">(uuidv7()), matterId: asId<"MatterId">(id), contactId: asId<"ContactId">(contactId), role: "MOTPART",
    });
    await accepted(call("matter.removeContact", { matterContactId: link.id }));
    expect(await repos.matterContacts.getByIdInOrg(link.id, asId<"OrganizationId">(ORG))).toBeNull();
  });

  it("removeContact på en annan byrås koppling: NOT_FOUND, kopplingen finns kvar", async () => {
    const foreignOrg = uuidv7();
    const matterId = uuidv7();
    const contactId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: foreignOrg, title: "Annan byrå", status: "ACTIVE", matterNumber: "2025-9998" } as never);
    await repos.contacts.create({ id: contactId, organizationId: foreignOrg, name: "Annans klient", contactType: "PERSON" } as never);
    const link = await repos.matterContacts.linkContact({
      id: asId<"MatterContactId">(uuidv7()), matterId: asId<"MatterId">(matterId), contactId: asId<"ContactId">(contactId), role: "KLIENT",
    });
    expect(await replayer.replay(call("matter.removeContact", { matterContactId: link.id }), ctx)).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await repos.matterContacts.getByIdInOrg(link.id, asId<"OrganizationId">(foreignOrg))).toMatchObject({ id: link.id });
  });
});
