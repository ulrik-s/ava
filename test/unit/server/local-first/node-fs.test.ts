/**
 * Tester för NodeFileSystem — bekräftar att den uppfyller samma
 * IFileSystem-kontrakt som InMemoryFileSystem (Liskov-substituerbarhet).
 *
 * Använder os.tmpdir() så testen är isolerade per-suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileSystem } from "@/server/local-first/node-fs";

describe("NodeFileSystem", () => {
  let root: string;
  let fs: NodeFileSystem;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ava-nodefs-"));
    fs = new NodeFileSystem(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writeFile + readFile round-trip", async () => {
    await fs.writeFile("hello.txt", "Hej");
    expect(await fs.readFile("hello.txt")).toBe("Hej");
  });

  it("writeFile skapar nested mappar automatiskt", async () => {
    await fs.writeFile("a/b/c.txt", "djupt");
    expect(await fs.readFile("a/b/c.txt")).toBe("djupt");
  });

  it("exists returnerar false för okänt", async () => {
    expect(await fs.exists("missing.txt")).toBe(false);
  });

  it("exists returnerar true efter write", async () => {
    await fs.writeFile("x.txt", "y");
    expect(await fs.exists("x.txt")).toBe(true);
  });

  it("readFile på okänt kastar med ENOENT-kod", async () => {
    await expect(fs.readFile("nope.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("appendFile appendar och skapar fil om den saknas", async () => {
    await fs.appendFile("log.txt", "a\n");
    await fs.appendFile("log.txt", "b\n");
    expect(await fs.readFile("log.txt")).toBe("a\nb\n");
  });

  it("appendFile skapar parent-mappar om de saknas", async () => {
    await fs.appendFile("events/2026/05/18.jsonl", "first\n");
    expect(await fs.exists("events/2026/05/18.jsonl")).toBe(true);
  });

  it("listDir returnerar direkt-children", async () => {
    await fs.writeFile("matters/active/a.json", "{}");
    await fs.writeFile("matters/active/b.json", "{}");
    await fs.writeFile("matters/archive/2025/c.json", "{}");
    const direct = await fs.listDir("matters/active");
    expect(direct.sort()).toEqual(["a.json", "b.json"]);
  });

  it("listDir på okänt prefix returnerar tom array (inte fel)", async () => {
    expect(await fs.listDir("doesnt-exist")).toEqual([]);
  });

  it("deleteFile rensar filen", async () => {
    await fs.writeFile("x.txt", "y");
    await fs.deleteFile("x.txt");
    expect(await fs.exists("x.txt")).toBe(false);
  });

  it("deleteFile är no-op om filen inte finns (inget kast)", async () => {
    await expect(fs.deleteFile("ghost.txt")).resolves.toBeUndefined();
  });

  it("avvisar paths med .. för säkerhet (path traversal)", async () => {
    await expect(fs.readFile("../../etc/passwd")).rejects.toThrow(/path.*outside|escape/i);
    await expect(fs.writeFile("../escape.txt", "x")).rejects.toThrow(/path.*outside|escape/i);
  });

  it("läser filer skapade utanför NodeFileSystem (e.g. av git)", async () => {
    // Simulera att git skapat en fil direkt i working tree
    await mkdir(join(root, "git-made"), { recursive: true });
    await writeFile(join(root, "git-made", "file.txt"), "från git", "utf8");
    expect(await fs.readFile("git-made/file.txt")).toBe("från git");
  });

  it("file-content sparas på riktigt på disk", async () => {
    await fs.writeFile("on-disk.txt", "syns");
    const real = await readFile(join(root, "on-disk.txt"), "utf8");
    expect(real).toBe("syns");
  });
});
