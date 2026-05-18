import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";

describe("InMemoryFileSystem", () => {
  it("read efter write returnerar samma innehåll", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("a/b.txt", "Hej");
    expect(await fs.readFile("a/b.txt")).toBe("Hej");
  });

  it("exists returnerar false för icke-existerande filer", async () => {
    const fs = new InMemoryFileSystem();
    expect(await fs.exists("missing.txt")).toBe(false);
  });

  it("exists returnerar true efter write", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("a.txt", "x");
    expect(await fs.exists("a.txt")).toBe(true);
  });

  it("readFile på icke-existerande fil kastar", async () => {
    const fs = new InMemoryFileSystem();
    await expect(fs.readFile("none.txt")).rejects.toThrow(/ENOENT|not found/i);
  });

  it("appendFile lägger till på slutet av filen", async () => {
    const fs = new InMemoryFileSystem();
    await fs.appendFile("log.jsonl", "rad1\n");
    await fs.appendFile("log.jsonl", "rad2\n");
    expect(await fs.readFile("log.jsonl")).toBe("rad1\nrad2\n");
  });

  it("appendFile skapar filen om den inte fanns", async () => {
    const fs = new InMemoryFileSystem();
    await fs.appendFile("new.txt", "första");
    expect(await fs.readFile("new.txt")).toBe("första");
  });

  it("listDir returnerar fil- och mapp-namn direkt under prefixet", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("matters/active/a.json", "{}");
    await fs.writeFile("matters/active/b.json", "{}");
    await fs.writeFile("matters/archive/2025/c.json", "{}");
    const entries = await fs.listDir("matters/active");
    expect(entries.sort()).toEqual(["a.json", "b.json"]);
  });

  it("listDir returnerar tom array för okänd prefix", async () => {
    const fs = new InMemoryFileSystem();
    expect(await fs.listDir("nope")).toEqual([]);
  });

  it("deleteFile rensar filen", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("a.txt", "x");
    await fs.deleteFile("a.txt");
    expect(await fs.exists("a.txt")).toBe(false);
  });

  it("snapshot returnerar djup kopia (mutera kopian ändrar inte fs)", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("a.txt", "ursprung");
    const snap = fs.snapshot();
    snap["a.txt"] = "ändrat";
    expect(await fs.readFile("a.txt")).toBe("ursprung");
  });
});
