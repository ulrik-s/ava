/**
 * `DrizzleProcedureReplayer` (#1265, ADR 0037) — servern kör om ett köat
 * procedur-anrop auktoritativt, med SAMMA `appRouter` som klienten, i en
 * transaktion, som den användare som skickade det. pglite.
 *
 * Det som skyddas:
 *   - affärsreglerna gäller på servern (en fryst tidspost går inte att ändra
 *     även om klienten offline trodde det),
 *   - samma mutationId körs högst en gång (idempotens, även efter ett avbrott),
 *   - ett avvisat anrop lämnar inga halva skrivningar,
 *   - tekniska fel avvisar INTE (då skulle användarens arbete kastas) — de
 *     bubblar så att klienten försöker igen,
 *   - svaret bär de berörda radernas kanoniska läge, och bara inom byrån.
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { changeLog, syncReplays, users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const USER = uuidv7();

describe("DrizzleProcedureReplayer", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let matterId: string;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Omkörning", status: "ACTIVE", matterNumber: "2026-1265" } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>, touchIds: string[] = []): QueuedProcedureCall {
    return {
      type: "procedure", mutationId: uuidv7(), path, input, codeVersion: "test", enqueuedAt: 0,
      touches: touchIds.map((id) => ({ entity: "timeEntry", id })),
    };
  }

  const createInput = (id: string, extra: Record<string, unknown> = {}) => ({
    id, matterId, date: "2026-09-01", minutes: 30, description: "Samtal med klient", ...extra,
  });

  it("accepted: servern skapar raden med klientens id, som användaren, och loggar den", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("timeEntry.create", createInput(id), [id]), ctx);
    expect(res.status).toBe("accepted");
    const row = await repos.timeEntries.getById(asId<"TimeEntryId">(id));
    expect(row).toMatchObject({ id, userId: USER, minutes: 30 });
    expect(res.rows).toEqual([{ entity: "timeEntry", row: expect.objectContaining({ id, minutes: 30 }) }]);
    const logged = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id);
    expect(logged.map((r) => r.op)).toEqual(["create"]);
  });

  it("idempotent: samma mutationId körs inte två gånger", async () => {
    const id = uuidv7();
    const c = call("timeEntry.create", createInput(id), [id]);
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    const again = await replayer.replay(c, ctx);
    expect(again.status).toBe("accepted");
    const logged = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id);
    expect(logged).toHaveLength(1);
  });

  // #1332: två omkörningar av SAMMA anrop samtidigt (två flikar, två enheter,
  // ett omförsök medan det första pågår) — proceduren körs ändå en gång.
  it("samtidiga omkörningar av samma anrop: proceduren körs en gång, båda får samma utfall", async () => {
    const id = uuidv7();
    await replayer.replay(call("timeEntry.create", createInput(id), [id]), ctx);
    const update = call("timeEntry.update", { id, minutes: 45 }, [id]);
    const [a, b] = await Promise.all([replayer.replay(update, ctx), replayer.replay(update, ctx)]);
    expect([a.status, b.status]).toEqual(["accepted", "accepted"]);
    const logged = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id).map((r) => r.op);
    expect(logged).toEqual(["create", "update"]);
    expect((await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === update.mutationId)).toHaveLength(1);
  });

  it("samtidiga omkörningar som avvisas: samma avvisning, sparad en gång", async () => {
    const id = uuidv7();
    const update = call("timeEntry.update", { id, minutes: 10 }, [id]);
    const [a, b] = await Promise.all([replayer.replay(update, ctx), replayer.replay(update, ctx)]);
    expect(a).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(b).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect((await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === update.mutationId)).toHaveLength(1);
  });

  it("en avvisning efter att en samtidig omkörning sparat sitt utfall: det sparade utfallet gäller", async () => {
    const update = call("timeEntry.update", { id: uuidv7(), minutes: 10 });
    // Den andra omkörningen hinner spara "accepted" medan den här körs och avvisas.
    const racing = new DrizzleProcedureReplayer(handle.db, {
      ...repos,
      transactionWithDb: async () => {
        await handle.db.insert(syncReplays).values({
          mutationId: update.mutationId, organizationId: ORG, userId: USER, path: update.path, codeVersion: "test", status: "accepted",
        });
        throw new TRPCError({ code: "CONFLICT", message: "Raden ändrades" });
      },
    });
    expect(await racing.replay(update, ctx)).toMatchObject({ status: "accepted" });
  });

  it("affärsregeln gäller på servern: en fryst tidspost avvisas, med regelns eget meddelande", async () => {
    const id = uuidv7();
    await repos.timeEntries.create({
      id, matterId, userId: USER, date: new Date(), minutes: 60, description: "Fakturerad", hourlyRate: 1500, frozenAt: new Date(),
    } as never);
    const res = await replayer.replay(call("timeEntry.update", { id, minutes: 90 }, [id]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "PRECONDITION_FAILED" });
    expect(res.status === "rejected" && res.reason).toMatch(/slutfaktura eller kostnadsräkning/);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toMatchObject({ minutes: 60 });
    // Serverns läge följer med, så klienten kastar sitt optimistiska.
    expect(res.rows[0]).toMatchObject({ entity: "timeEntry", row: { id, minutes: 60 } });
  });

  it("en rad som raderats på servern: uppdateringen avvisas och svaret är en tombstone (ingen återuppståndelse)", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("timeEntry.update", { id, minutes: 10 }, [id]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(res.rows).toEqual([{ entity: "timeEntry", row: { id }, deleted: true }]);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toBeNull();
  });

  it("avvisningen minns: samma mutationId ger samma utfall utan att köras igen", async () => {
    const id = uuidv7();
    const c = call("timeEntry.update", { id, minutes: 10 }, [id]);
    await replayer.replay(c, ctx);
    const stored = (await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === c.mutationId);
    expect(stored).toHaveLength(1);
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  });

  it("ogiltig input (zod) → avvisad, inget skrivet", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("timeEntry.create", { id, matterId, date: "2026-09-01", minutes: 30, description: "" }, [id]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toBeNull();
  });

  it("en procedur som inte får köas → avvisad utan att köras", async () => {
    const res = await replayer.replay(call("contacts.create", { name: "Smugglad", contactType: "PERSON" }), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
  });

  it("tekniskt fel (databasen) → kastas, inget utfall sparas, så klienten försöker igen", async () => {
    const broken = new DrizzleProcedureReplayer(handle.db, {
      ...repos,
      transactionWithDb: async () => { throw new Error("connection terminated"); },
    });
    const c = call("timeEntry.create", createInput(uuidv7()));
    await expect(broken.replay(c, ctx)).rejects.toThrow(/connection terminated/);
    const stored = (await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === c.mutationId);
    expect(stored).toHaveLength(0);
  });

  it("berörda rader läses bara inom byrån — en annan byrås rad blir en tombstone, aldrig data", async () => {
    const foreignMatter = uuidv7();
    await repos.matters.create({ id: foreignMatter, organizationId: OTHER_ORG, title: "Annan byrå", status: "ACTIVE", matterNumber: "2026-9999" } as never);
    const foreign = uuidv7();
    await repos.timeEntries.create({
      id: foreign, matterId: foreignMatter, userId: uuidv7(), date: new Date(), minutes: 5, description: "Hemlig", hourlyRate: 1,
    } as never);
    const own = uuidv7();
    const res = await replayer.replay(call("timeEntry.create", createInput(own), [own, foreign]), ctx);
    expect(res.rows).toContainEqual({ entity: "timeEntry", row: { id: foreign }, deleted: true });
    expect(JSON.stringify(res.rows)).not.toContain("Hemlig");
  });

  it("document.analyze körs om: SERVERNS klassificering köas (#1156)", async () => {
    const docId = uuidv7();
    await repos.documents.create({
      id: docId, matterId, fileName: "skanning.pdf", mimeType: "application/pdf", storagePath: "documents/content/x", sizeBytes: 1, uploadedById: USER,
    } as never);
    const analyzed: string[] = [];
    const withAnalyzer = buildContext({
      repos, eventLog: serverFirstEventLog,
      ports: { ...noopPorts, documentAnalyzer: { analyze: async (id) => { analyzed.push(id); } } },
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
    // Inga touches: klassningen skriver ingenting synkront — resultatet når
    // klienten via pull när jobbet är klart.
    const c = call("document.analyze", { documentId: docId });
    expect(await replayer.replay(c, withAnalyzer)).toMatchObject({ status: "accepted", rows: [] });
    expect(analyzed).toEqual([docId]);
    // Idempotent: samma mutationId köar inte en klassning till.
    await replayer.replay(c, withAnalyzer);
    expect(analyzed).toEqual([docId]);
  });

  it("delete körs om och loggas (tombstone når andra klienter, #1234)", async () => {
    const id = uuidv7();
    await replayer.replay(call("timeEntry.create", createInput(id), [id]), ctx);
    const res = await replayer.replay(call("timeEntry.delete", { id }, [id]), ctx);
    expect(res.status).toBe("accepted");
    expect(res.rows).toEqual([{ entity: "timeEntry", row: { id }, deleted: true }]);
    const logged = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id);
    expect(logged.map((r) => r.op)).toEqual(["create", "delete"]);
  });

  // #1247: köformatet. En klient som varit offline länge kan ha köat anrop i ett
  // format servern inte längre stöder — eller vara nyare än servern.
  it("köformat nyare än servern → kastar, inget utfall sparas (klienten försöker igen)", async () => {
    const id = uuidv7();
    const c = { ...call("timeEntry.create", createInput(id), [id]), format: 99 };
    await expect(replayer.replay(c, ctx)).rejects.toThrow(/Servern kör en äldre version/);
    expect((await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === c.mutationId)).toHaveLength(0);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toBeNull();
  });

  it("för gammalt köformat → avvisat med besked, sparat, och klientens rad blir en tombstone", async () => {
    const strict = new DrizzleProcedureReplayer(handle.db, repos, { current: 2, min: 2, migrations: {} });
    const id = uuidv7();
    const c = { ...call("timeEntry.create", createInput(id), [id]), format: 1 };
    const res = await strict.replay(c, ctx);
    expect(res).toMatchObject({ status: "rejected", code: "PRECONDITION_FAILED" });
    expect(res.status === "rejected" && res.reason).toMatch(/för gammal version av AVA/);
    expect(res.rows).toEqual([{ entity: "timeEntry", row: { id }, deleted: true }]);
    expect((await handle.db.select().from(syncReplays)).filter((r) => r.mutationId === c.mutationId)).toHaveLength(1);
  });

  it("ett äldre, stött köformat migreras och körs", async () => {
    const migrating = new DrizzleProcedureReplayer(handle.db, repos, {
      current: 2, min: 1,
      migrations: { 1: (p) => ({ ...p, input: { ...p.input, minutes: Number(p.input?.hours) * 60 } }) },
    });
    const id = uuidv7();
    const { minutes: _minutes, ...legacy } = createInput(id);
    const res = await migrating.replay({ ...call("timeEntry.create", { ...legacy, hours: 2 }, [id]), format: 1 }, ctx);
    expect(res.status).toBe("accepted");
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toMatchObject({ minutes: 120 });
  });
});
