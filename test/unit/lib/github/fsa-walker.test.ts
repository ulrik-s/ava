/**
 * Tester för fsa-walker: walkFsa + writeFile + deleteFile.
 *
 * Använder in-memory fake-FSA. walkFsa beräknar git-blob-SHA per fil så
 * vi kan jämföra exakt med kanoniska SHA-värden från `git hash-object`.
 */

import { describe, expect, it } from "vitest";
import { walkFsa, writeFile, deleteFile } from "@/lib/client/github/fsa-walker";
import { gitBlobSha1 } from "@/lib/client/github/git-blob-hash";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

async function seed(fsa: ReturnType<typeof makeFakeFsa>, path: string, content: string): Promise<void> {
  await writeFile(fsa.root, path, new TextEncoder().encode(content));
}

describe("walkFsa", () => {
  it("returnerar tom array för tom mapp", async () => {
    const fsa = makeFakeFsa();
    expect(await walkFsa(fsa.root)).toEqual([]);
  });

  it("listar alla filer med rätt path + blob-SHA", async () => {
    const fsa = makeFakeFsa();
    await seed(fsa, "matters/active/m-1.json", `{"id":"m-1"}`);
    await seed(fsa, "contacts/c-1.json", `{"id":"c-1"}`);
    const files = await walkFsa(fsa.root);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["contacts/c-1.json", "matters/active/m-1.json"]);
    // SHA stämmer med direkt git-blob-hash
    for (const f of files) {
      expect(f.sha).toBe(await gitBlobSha1(f.bytes));
    }
  });

  it("hoppar över .git/, .ava/, node_modules/, .next/, dist/", async () => {
    const fsa = makeFakeFsa();
    await seed(fsa, ".git/HEAD", "ref: refs/heads/main");
    await seed(fsa, ".ava/sync-state.json", "{}");
    await seed(fsa, "node_modules/foo/index.js", "x");
    await seed(fsa, ".next/build-info.json", "x");
    await seed(fsa, "dist/foo.js", "x");
    await seed(fsa, "real-file.json", "y");
    const paths = (await walkFsa(fsa.root)).map((f) => f.path);
    expect(paths).toEqual(["real-file.json"]);
  });

  it("hanterar binär data", async () => {
    const fsa = makeFakeFsa();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    await writeFile(fsa.root, "logos/firma.png", bytes);
    const files = await walkFsa(fsa.root);
    expect(files).toHaveLength(1);
    expect(files[0]!.bytes).toEqual(bytes);
  });
});

describe("writeFile", () => {
  it("skriver fil + skapar mellanliggande kataloger", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "deep/nested/path/file.txt", new TextEncoder().encode("hej"));
    expect(fsa.hasDir("deep/nested/path")).toBe(true);
    const bytes = fsa.readFile("deep/nested/path/file.txt");
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe("hej");
  });

  it("skriver fil på root", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "rootfile.json", new TextEncoder().encode("{}"));
    expect(fsa.readFile("rootfile.json")).not.toBeNull();
  });

  it("ersätter befintlig fil", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "x.txt", new TextEncoder().encode("v1"));
    await writeFile(fsa.root, "x.txt", new TextEncoder().encode("v2"));
    expect(new TextDecoder().decode(fsa.readFile("x.txt")!)).toBe("v2");
  });
});

describe("deleteFile", () => {
  it("tar bort en befintlig fil", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "a.json", new TextEncoder().encode("{}"));
    await deleteFile(fsa.root, "a.json");
    expect(fsa.readFile("a.json")).toBeNull();
  });

  it("ignorerar saknad fil (idempotent)", async () => {
    const fsa = makeFakeFsa();
    await expect(deleteFile(fsa.root, "nope.txt")).resolves.toBeUndefined();
  });

  it("ignorerar saknad mellanliggande katalog", async () => {
    const fsa = makeFakeFsa();
    await expect(deleteFile(fsa.root, "a/b/c/missing.txt")).resolves.toBeUndefined();
  });

  it("tar bort fil under nästade kataloger", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "deep/a.json", new TextEncoder().encode("{}"));
    await deleteFile(fsa.root, "deep/a.json");
    expect(fsa.readFile("deep/a.json")).toBeNull();
  });
});
