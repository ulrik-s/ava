import { describe, it, expect } from "vitest";
import { FilesystemEventLog } from "@/server/local-first/filesystem-event-log";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";

function makeLog() {
  const fs = new InMemoryFileSystem();
  const log = new FilesystemEventLog(fs);
  return { fs, log };
}

describe("FilesystemEventLog — emit", () => {
  it("skapar event-id (UUID v7) och ts automatiskt", async () => {
    const { log } = makeLog();
    const event = await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: {},
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.type).toBe("matter.created");
  });

  it("appendar till JSONL-fil baserat på event.ts", async () => {
    const { fs, log } = makeLog();
    const event = await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { matterNumber: "2026-0001" },
    });
    const path = `events/${event.ts.slice(0, 4)}/${event.ts.slice(5, 7)}/${event.ts.slice(8, 10)}.jsonl`;
    expect(await fs.exists(path)).toBe(true);
    const content = await fs.readFile(path);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("flera events i samma dag samlas i samma fil", async () => {
    const { fs, log } = makeLog();
    await log.emit({
      type: "matter.created", source: "ui",
      actor: { kind: "user", id: "anna" }, payload: {},
    });
    await log.emit({
      type: "contact.created", source: "ui",
      actor: { kind: "user", id: "anna" }, payload: {},
    });
    const today = new Date();
    const path = `events/${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, "0")}/${String(today.getUTCDate()).padStart(2, "0")}.jsonl`;
    const content = await fs.readFile(path);
    expect(content.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("notifierar listeners när event emittas", async () => {
    const { log } = makeLog();
    const handler = vi.fn();
    log.onNewEvent(handler);
    await log.emit({
      type: "matter.created", source: "ui",
      actor: { kind: "user", id: "anna" }, payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("FilesystemEventLog — query", () => {
  it("returnerar tom array när loggen är tom", async () => {
    const { log } = makeLog();
    expect(await log.query({})).toEqual([]);
  });

  it("query() returnerar emittade events i kronologisk ordning", async () => {
    const { log } = makeLog();
    await log.emit({ type: "matter.created", source: "ui", actor: { kind: "user", id: "anna" }, payload: {} });
    await new Promise((r) => setTimeout(r, 2)); // garantera olika ms
    await log.emit({ type: "matter.updated", source: "ui", actor: { kind: "user", id: "anna" }, payload: {} });
    const events = await log.query({});
    expect(events).toHaveLength(2);
    expect(events[0].ts <= events[1].ts).toBe(true);
  });

  it("filtrerar på type", async () => {
    const { log } = makeLog();
    await log.emit({ type: "matter.created", source: "ui", actor: { kind: "user", id: "anna" }, payload: {} });
    await log.emit({ type: "contact.created", source: "ui", actor: { kind: "user", id: "anna" }, payload: {} });
    const matters = await log.query({ type: "matter.created" });
    expect(matters).toHaveLength(1);
    expect(matters[0].type).toBe("matter.created");
  });

  it("filtrerar på matterId", async () => {
    const { log } = makeLog();
    await log.emit({ type: "matter.updated", source: "ui", actor: { kind: "user", id: "anna" }, payload: {}, matterId: "m1" });
    await log.emit({ type: "matter.updated", source: "ui", actor: { kind: "user", id: "anna" }, payload: {}, matterId: "m2" });
    const m1Events = await log.query({ matterId: "m1" });
    expect(m1Events).toHaveLength(1);
    expect(m1Events[0].matterId).toBe("m1");
  });
});

import { vi } from "vitest";
