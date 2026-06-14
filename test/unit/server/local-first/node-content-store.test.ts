/**
 * Tester för `NodeContentStore` (#72 slice 1) — skriver dokument-bytes in i
 * git-working-copy:n så de kan commit:as/push:as. Använder os.tmpdir() för
 * isolering per suite.
 */

import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { noopContentStore } from "@/lib/server/adapters/noop-ports";
import { NodeContentStore } from "@/lib/server/local-first/node-content-store";

describe("noopContentStore", () => {
  it("är en tyst no-op (demo/web skriver bytes klient-sidigt via FSA)", async () => {
    await expect(noopContentStore.write("documents/content/x.eml", new Uint8Array([1])))
      .resolves.toBeUndefined();
  });
});

describe("NodeContentStore", () => {
  let root: string;
  let store: NodeContentStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-content-"));
    store = new NodeContentStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("skriver bytes till storagePath under working-copy:n", async () => {
    const bytes = new Uint8Array([0x46, 0x72, 0xc3, 0xa5, 0x6e]); // "Från" i utf8 m. icke-ascii
    await store.write("documents/content/abc.eml", bytes);
    const real = await readFile(join(root, "documents/content/abc.eml"));
    expect(new Uint8Array(real)).toEqual(bytes);
  });

  it("strippar ledande '/' (isomorphic-git-konvention) → skriver i roten", async () => {
    await store.write("/documents/content/slash.eml", new Uint8Array([1, 2]));
    const real = await readFile(join(root, "documents/content/slash.eml"));
    expect(new Uint8Array(real)).toEqual(new Uint8Array([1, 2]));
  });

  it("avvisar path-traversal (säkerhet — path kan komma från klient)", async () => {
    await expect(store.write("../../escape.eml", new Uint8Array([1])))
      .rejects.toThrow(/path.*outside|escape/i);
  });
});
