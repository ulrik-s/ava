/**
 * Tester för `WriteThroughProjector` — event-log-listenern som auto-
 * projicerar entiteter till JSON-filer vid Prisma-writes.
 *
 * Designprincip: routrarna ändras INTE. De gör `ctx.dataStore.matters.create()`
 * + `emit.matterCreated()` precis som idag. Projector:n lyssnar på eventet,
 * läser tillbaka entiteten från SQLite, och projicerar den till fil.
 *
 * Detta ger Open-closed: ny event-typ = ny mapping-rad, ingen ändring av
 * core-koden.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { WriteThroughProjector } from "@/server/local-first/write-through-projector";
import { ProjectionWriter } from "@/server/local-first/projection-writer";
import { buildDefaultRegistry } from "@/server/local-first/projections/default-registry";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";
import { FilesystemEventLog } from "@/server/local-first/filesystem-event-log";
import type { IDataStore } from "@/server/data-store/IDataStore";
import type { MatterProjectionData } from "@/server/local-first/projections/matter";

interface MockStoreData {
  matters: Record<string, unknown>;
  contacts: Record<string, unknown>;
  users: Record<string, unknown>;
}
type MockStore = IDataStore & { _data: MockStoreData };

function makeMockStore(): MockStore {
  const data: MockStoreData = { matters: {}, contacts: {}, users: {} };
  const finder = (bag: Record<string, unknown>) => ({
    findUnique: async ({ where }: { where: { id: string } }) => bag[where.id] ?? null,
  });
  return {
    events: undefined,
    matters: finder(data.matters),
    contacts: finder(data.contacts),
    users: finder(data.users),
    _data: data,
  } as unknown as MockStore;
}

const sampleMatter: MatterProjectionData = {
  id: "matter-1",
  matterNumber: "2026-0001",
  title: "Vårdnadstvist",
  status: "ACTIVE",
  organizationId: "org-1",
};

describe("WriteThroughProjector — matter-events", () => {
  let fs: InMemoryFileSystem;
  let log: FilesystemEventLog;
  let store: ReturnType<typeof makeMockStore>;
  let projector: WriteThroughProjector;
  let dispose: () => void;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    log = new FilesystemEventLog(fs);
    store = makeMockStore();
    const writer = new ProjectionWriter(fs, buildDefaultRegistry());
    projector = new WriteThroughProjector(writer, store);
    dispose = projector.attach(log);
  });

  it("projicerar matter på matter.created-event", async () => {
    store._data.matters["matter-1"] = sampleMatter;
    await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: { matterNumber: "2026-0001", title: "Vårdnadstvist" },
    });
    await new Promise((r) => setImmediate(r));

    expect(await fs.exists("matters/active/matter-1.json")).toBe(true);
    const content = JSON.parse(await fs.readFile("matters/active/matter-1.json"));
    expect(content.id).toBe("matter-1");
  });

  it("projicerar matter på matter.updated-event (samma path)", async () => {
    store._data.matters["matter-1"] = sampleMatter;
    await log.emit({
      type: "matter.updated",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: { patch: {} },
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/active/matter-1.json")).toBe(true);
  });

  it("flyttar matter till archive vid matter.archived", async () => {
    store._data.matters["matter-1"] = { ...sampleMatter, status: "ARCHIVED", archivedAt: "2024-05-18T00:00:00.000Z" };
    await log.emit({
      type: "matter.archived",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/archive/2024/matter-1.json")).toBe(true);
  });

  it("skippar event utan matterId (skadat event)", async () => {
    await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      // matterId saknas
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/active/matter-1.json")).toBe(false);
  });

  it("skippar event där entitet inte finns i store", async () => {
    // Ingen data i store._data.matters
    await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-ghost",
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/active/matter-ghost.json")).toBe(false);
  });

  it("disposer avregistrerar listenern — projicerar inte längre", async () => {
    dispose();
    store._data.matters["matter-1"] = sampleMatter;
    await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-1",
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/active/matter-1.json")).toBe(false);
  });
});

describe("WriteThroughProjector — contact + user", () => {
  let fs: InMemoryFileSystem;
  let log: FilesystemEventLog;
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    log = new FilesystemEventLog(fs);
    store = makeMockStore();
    const writer = new ProjectionWriter(fs, buildDefaultRegistry());
    new WriteThroughProjector(writer, store).attach(log);
  });

  it("projicerar contact på contact.created", async () => {
    const contact = {
      id: "c1", name: "Anna Klient", contactType: "PERSON", organizationId: "org-1",
    };
    store._data.contacts["c1"] = contact;
    await log.emit({
      type: "contact.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { contactId: "c1", name: "Anna Klient" },
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("contacts/c1.json")).toBe(true);
  });

  it("raderar contact-fil på contact.deleted", async () => {
    // Pre-seed projicerad fil
    await fs.writeFile("contacts/c1.json", '{"id":"c1","name":"x","contactType":"PERSON","organizationId":"org-1"}');
    expect(await fs.exists("contacts/c1.json")).toBe(true);

    await log.emit({
      type: "contact.deleted",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { contactId: "c1" },
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("contacts/c1.json")).toBe(false);
  });
});

describe("WriteThroughProjector — robusthet", () => {
  it("en projektionskrasch tar inte ner listenern", async () => {
    const fs = new InMemoryFileSystem();
    const log = new FilesystemEventLog(fs);
    const store = makeMockStore();
    // Lagra ett objekt som inte matchar schemat
    store._data.matters["bad"] = { id: "bad" } as never;
    const writer = new ProjectionWriter(fs, buildDefaultRegistry());
    new WriteThroughProjector(writer, store).attach(log);

    await expect(
      log.emit({
        type: "matter.created",
        source: "ui",
        actor: { kind: "user", id: "anna" },
        matterId: "bad",
        payload: {},
      }),
    ).resolves.toBeDefined();

    // listenern är fortfarande aktiv för korrekta events
    store._data.matters["matter-good"] = sampleMatter;
    await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "matter-good",
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(await fs.exists("matters/active/matter-1.json")).toBe(true);
  });

  it("ignorerar event-typer utan mapping (regel-events m.fl.)", async () => {
    const fs = new InMemoryFileSystem();
    const log = new FilesystemEventLog(fs);
    const store = makeMockStore();
    const writer = new ProjectionWriter(fs, buildDefaultRegistry());
    new WriteThroughProjector(writer, store).attach(log);

    await log.emit({
      type: "rule.executed",
      source: "rule",
      actor: { kind: "rule", id: "_org/foo" },
      payload: { stepsRan: 1 },
    });
    await new Promise((r) => setImmediate(r));
    // Inget kraschat, inga oväntade filer
    expect(await fs.listDir("matters/active")).toEqual([]);
  });
});
