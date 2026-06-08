/**
 * Tester för sync-state — JSON-metadata om senaste pull i FSA-mappen.
 */

import { describe, expect, it } from "vitest-compat";
import { readSyncState, writeSyncState, pathFor } from "@/lib/client/github/sync-state";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

const sampleState = {
  version: 1 as const,
  branch: "main",
  lastHead: "abc123",
  lastTree: "def456",
  lastSyncedAt: "2026-05-24T10:00:00Z",
  files: { "matters/active/m-1.json": "blob1sha", "contacts/c-1.json": "blob2sha" },
};

describe("sync-state", () => {
  it("pathFor returnerar fast .ava/sync-state.json", () => {
    expect(pathFor()).toBe(".ava/sync-state.json");
  });

  it("readSyncState returnerar null när filen saknas", async () => {
    const fsa = makeFakeFsa();
    expect(await readSyncState(fsa.root)).toBeNull();
  });

  it("writeSyncState + readSyncState round-trip", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, sampleState);
    expect(await readSyncState(fsa.root)).toEqual(sampleState);
    // Persisterad till .ava/sync-state.json
    expect(fsa.readFile(".ava/sync-state.json")).not.toBeNull();
  });

  it("readSyncState returnerar null vid okänd version", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, sampleState);
    // Manipulera versionen direkt på disk
    const bytes = new TextEncoder().encode(JSON.stringify({ ...sampleState, version: 2 }));
    const ava = await fsa.root.getDirectoryHandle(".ava");
    const file = await ava.getFileHandle("sync-state.json");
    const w = await (file as FileSystemFileHandle).createWritable();
    await w.write(bytes);
    await w.close();
    expect(await readSyncState(fsa.root)).toBeNull();
  });

  it("readSyncState returnerar null vid korrupt JSON", async () => {
    const fsa = makeFakeFsa();
    const ava = await fsa.root.getDirectoryHandle(".ava", { create: true });
    const file = await ava.getFileHandle("sync-state.json", { create: true });
    const w = await (file as FileSystemFileHandle).createWritable();
    await w.write("not-json");
    await w.close();
    expect(await readSyncState(fsa.root)).toBeNull();
  });

  it("writeSyncState skapar .ava-mappen om den saknas", async () => {
    const fsa = makeFakeFsa();
    expect(fsa.hasDir(".ava")).toBe(false);
    await writeSyncState(fsa.root, sampleState);
    expect(fsa.hasDir(".ava")).toBe(true);
  });

  it("writeSyncState skriver pretty-printad JSON", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, sampleState);
    const bytes = fsa.readFile(".ava/sync-state.json")!;
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("\n  "); // indentation
    expect(JSON.parse(text)).toEqual(sampleState);
  });
});
