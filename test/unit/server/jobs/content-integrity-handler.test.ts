/**
 * Integritetskontrollen som schemalagt jobb (#1993): handlern kör kontrollen
 * med sina läsningar, loggar `content.integrity.missing` respektive
 * `content.integrity.ok` för byrån, och ett läsfel kastas vidare så att
 * pg-boss försöker igen.
 */

import type { Job } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import type { ContentIntegrityDeps } from "@/lib/server/integrity/content-integrity";
import { createContentIntegrityHandler } from "@/lib/server/jobs/handlers/content-integrity-handler";
import type { StoredContentRow } from "@/lib/server/repositories/document-repository";
import { arraySink, setLogSink, type LogRecord, type LogSink } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

const job: Job = {
  id: "j1", name: "content-integrity", data: {}, expireInSeconds: 60, heartbeatSeconds: null,
  retryCount: 0, signal: new AbortController().signal,
};

/** Ett dokument som är ett dygn gammalt, alltså över åldersgränsen. */
const row = (id: string, storagePath: string): StoredContentRow => ({
  id: asId<"DocumentId">(id), storagePath, createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
});

function deps(rows: StoredContentRow[], present: string[]): ContentIntegrityDeps {
  return {
    listStoredContent: vi.fn(() => Promise.resolve(rows)),
    exists: vi.fn((p: string) => Promise.resolve(present.includes(p))),
  };
}

describe("createContentIntegrityHandler", () => {
  let records: LogRecord[] = [];
  let previous: LogSink;
  beforeEach(() => { records = []; previous = setLogSink(arraySink(records)); });
  afterEach(() => { setLogSink(previous); });

  it("saknat innehåll loggas som content.integrity.missing (error) för byrån", async () => {
    const d = deps([row("a", "documents/content/a"), row("b", "documents/content/b")], ["documents/content/a"]);
    await createContentIntegrityHandler({ deps: d, orgId: "org-1" })(job);
    expect(d.exists).toHaveBeenCalledWith("documents/content/b");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "error", event: "content.integrity.missing", orgId: "org-1", count: 1, total: 2, ids: ["b"] });
  });

  it("en ren kontroll loggas som content.integrity.ok", async () => {
    await createContentIntegrityHandler({ deps: deps([row("a", "documents/content/a")], ["documents/content/a"]), orgId: "org-1" })(job);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "info", event: "content.integrity.ok", orgId: "org-1", count: 0, total: 1 });
  });

  it("en given logger används i stället för byråns", async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    await createContentIntegrityHandler({ deps: deps([], []), orgId: "org-1" }, log)(job);
    expect(log.info).toHaveBeenCalledWith("content.integrity.ok", { total: 0, count: 0 });
    expect(records).toHaveLength(0);
  });

  it("ett fel i läsningen kastas vidare, så att kön försöker igen", async () => {
    const d: ContentIntegrityDeps = { listStoredContent: () => Promise.reject(new Error("db nere")), exists: () => Promise.resolve(true) };
    await expect(createContentIntegrityHandler({ deps: d, orgId: "org-1" })(job)).rejects.toThrow("db nere");
    expect(records).toHaveLength(0);
  });
});
