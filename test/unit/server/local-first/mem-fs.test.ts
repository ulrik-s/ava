/**
 * Tester för `MemFs` — backend som exponerar BÅDA `IFileSystem`-API:t
 * och en node-fs-kompatibel callback-API som `isomorphic-git` förväntar
 * sig.
 *
 * Det här gör att browser-runtime (Fas 4) kan ha ETT shared in-memory
 * filsystem som både `LocalGitStore` och `IsomorphicGitOps` ser samma
 * data i.
 *
 * Designmål:
 *   - Single responsibility: bara filsystem-storage. Inga git-detaljer.
 *   - DRY: vi har InMemoryFileSystem från tidigare — MemFs delegerar
 *     IFileSystem-delen dit och lägger BARA till node-fs-API:t ovanpå.
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { MemFs } from "@/lib/server/local-first/mem-fs";

describe("MemFs — IFileSystem-yta", () => {
  let mem: MemFs;
  beforeEach(() => { mem = new MemFs(); });

  it("uppfyller IFileSystem.writeFile + readFile", async () => {
    await mem.writeFile("a/b.txt", "hej");
    expect(await mem.readFile("a/b.txt")).toBe("hej");
  });

  it("appendFile + listDir + exists + deleteFile fungerar", async () => {
    await mem.appendFile("log.jsonl", "rad1\n");
    expect(await mem.exists("log.jsonl")).toBe(true);
    await mem.appendFile("log.jsonl", "rad2\n");
    expect((await mem.readFile("log.jsonl")).split("\n").filter(Boolean)).toHaveLength(2);
    await mem.writeFile("matters/active/a.json", "{}");
    await mem.writeFile("matters/active/b.json", "{}");
    expect((await mem.listDir("matters/active")).sort()).toEqual(["a.json", "b.json"]);
    await mem.deleteFile("log.jsonl");
    expect(await mem.exists("log.jsonl")).toBe(false);
  });
});

describe("MemFs — node-fs-yta (isomorphic-git-kompatibel)", () => {
  let mem: MemFs;
  beforeEach(() => { mem = new MemFs(); });

  it("nodeFs.writeFile + readFile är samma underliggande data som IFileSystem", async () => {
    const nfs = mem.nodeFs();
    // Skriv via node-fs-yta
    await new Promise<void>((resolve, reject) =>
      nfs.writeFile("/x.txt", Buffer.from("via-node"), (err) => err ? reject(err) : resolve()),
    );
    // Läs via IFileSystem-yta → samma data
    expect(await mem.readFile("x.txt")).toBe("via-node");
  });

  it("nodeFs.readFile returnerar Buffer eller string beroende på encoding", async () => {
    await mem.writeFile("file.txt", "hej");
    const nfs = mem.nodeFs();
    // Utan encoding → Buffer
    const buf = await new Promise<Buffer>((resolve, reject) =>
      nfs.readFile("/file.txt", (err: Error | null, data?: Buffer) => err ? reject(err) : resolve(data!)),
    );
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).toBe("hej");

    // Med utf8 → string
    const str = await new Promise<string>((resolve, reject) =>
      nfs.readFile("/file.txt", "utf8", (err: Error | null, data?: string) => err ? reject(err) : resolve(data!)),
    );
    expect(str).toBe("hej");
  });

  it("nodeFs.readdir listar barn i mapp", async () => {
    await mem.writeFile("dir/a.json", "{}");
    await mem.writeFile("dir/b.json", "{}");
    const nfs = mem.nodeFs();
    const entries = await new Promise<string[]>((resolve, reject) =>
      nfs.readdir("/dir", (err: Error | null, files?: string[]) => err ? reject(err) : resolve(files!)),
    );
    expect(entries.sort()).toEqual(["a.json", "b.json"]);
  });

  it("nodeFs.mkdir är no-op (path implicit via writeFile)", async () => {
    const nfs = mem.nodeFs();
    await new Promise<void>((resolve, reject) =>
      nfs.mkdir("/new-dir", (err: Error | null) => err ? reject(err) : resolve()),
    );
    // Inget krasch
  });

  it("nodeFs.unlink raderar fil", async () => {
    await mem.writeFile("doomed.txt", "x");
    const nfs = mem.nodeFs();
    await new Promise<void>((resolve, reject) =>
      nfs.unlink("/doomed.txt", (err: Error | null) => err ? reject(err) : resolve()),
    );
    expect(await mem.exists("doomed.txt")).toBe(false);
  });

  it("nodeFs.stat returnerar isFile/isDirectory korrekt", async () => {
    await mem.writeFile("dir/x.txt", "x");
    const nfs = mem.nodeFs();

    const fileStat = await new Promise<{ isFile: () => boolean; isDirectory: () => boolean }>((resolve, reject) =>
      nfs.stat("/dir/x.txt", (err: Error | null, s?: { isFile: () => boolean; isDirectory: () => boolean }) => err ? reject(err) : resolve(s!)),
    );
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isDirectory()).toBe(false);

    const dirStat = await new Promise<{ isFile: () => boolean; isDirectory: () => boolean }>((resolve, reject) =>
      nfs.stat("/dir", (err: Error | null, s?: { isFile: () => boolean; isDirectory: () => boolean }) => err ? reject(err) : resolve(s!)),
    );
    expect(dirStat.isDirectory()).toBe(true);
  });

  it("nodeFs.stat callbackar med ENOENT för okänd path", async () => {
    const nfs = mem.nodeFs();
    await expect(new Promise((_, reject) =>
      nfs.stat("/nope.txt", (err: Error | null) => err ? reject(err) : null),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leading slash är optional — '/file.txt' och 'file.txt' är samma fil", async () => {
    await mem.writeFile("foo.txt", "x");
    const nfs = mem.nodeFs();
    const buf = await new Promise<Buffer>((resolve, reject) =>
      nfs.readFile("/foo.txt", (err: Error | null, data?: Buffer) => err ? reject(err) : resolve(data!)),
    );
    expect(buf.toString("utf8")).toBe("x");
  });
});

describe("MemFs — snapshot/restore för persistens", () => {
  it("snapshot är JSON-serialiserbar (paths → base64-strängar)", async () => {
    const mem = new MemFs();
    await mem.writeFile("a.txt", "Hej");
    await mem.writeFile("b/c.txt", "Värld");
    const snap = mem.snapshot();

    const serialized = JSON.stringify(snap);
    expect(serialized).toContain("a.txt");
    expect(serialized).toContain("b/c.txt");

    const parsed = JSON.parse(serialized);
    expect(typeof parsed["a.txt"]).toBe("string");
  });

  it("restore tömmer existerande data och laddar nytt", async () => {
    const mem = new MemFs();
    await mem.writeFile("kvar.txt", "ursprung");
    await mem.writeFile("a.txt", "ursprung");
    const snap = mem.snapshot();

    await mem.writeFile("a.txt", "ändrad");
    await mem.deleteFile("kvar.txt");
    await mem.writeFile("extra.txt", "ska bort");

    mem.restore(snap);
    expect(await mem.readFile("a.txt")).toBe("ursprung");
    expect(await mem.readFile("kvar.txt")).toBe("ursprung");
    expect(await mem.exists("extra.txt")).toBe(false);
  });

  it("snapshot → JSON → restore bevarar UTF-8/emoji", async () => {
    const mem = new MemFs();
    await mem.writeFile("sv.txt", "Åäö ÅÄÖ åäö");
    await mem.writeFile("emoji.txt", "✓ 🎉");
    const json = JSON.parse(JSON.stringify(mem.snapshot()));
    const fresh = new MemFs();
    fresh.restore(json);
    expect(await fresh.readFile("sv.txt")).toBe("Åäö ÅÄÖ åäö");
    expect(await fresh.readFile("emoji.txt")).toBe("✓ 🎉");
  });

  it("snapshot av tom MemFs är tomt objekt", () => {
    expect(new MemFs().snapshot()).toEqual({});
  });

  it("restore med null är no-op", async () => {
    const mem = new MemFs();
    await mem.writeFile("kvar.txt", "x");
    mem.restore(null);
    expect(await mem.readFile("kvar.txt")).toBe("x");
  });
});
