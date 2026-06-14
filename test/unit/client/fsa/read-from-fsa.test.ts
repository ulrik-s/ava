/**
 * Tester för `readFromFsa` (#27 — otestad FSA-läshjälp). Bygger ett fejk-
 * FileSystemDirectoryHandle-träd och verifierar nästlad traversering, single-
 * level-fil, samt null vid tom path / saknad mapp / saknad fil.
 */
import { describe, it, expect } from "vitest-compat";
import { readFromFsa } from "@/lib/client/fsa/read-from-fsa";

function file(content: string) {
  return { getFile: async () => new Blob([content], { type: "text/plain" }) };
}

type Child = { kind: "dir" | "file"; node: unknown };
function dir(children: Record<string, Child>): FileSystemDirectoryHandle {
  return {
    getDirectoryHandle: async (name: string) => {
      const c = children[name];
      if (!c || c.kind !== "dir") throw new Error(`no dir ${name}`);
      return c.node;
    },
    getFileHandle: async (name: string) => {
      const c = children[name];
      if (!c || c.kind !== "file") throw new Error(`no file ${name}`);
      return c.node;
    },
  } as unknown as FileSystemDirectoryHandle;
}

const textDir = dir({ "d1.txt": { kind: "file", node: file("hello") } });
const docsDir = dir({ text: { kind: "dir", node: textDir } });
const root = dir({
  documents: { kind: "dir", node: docsDir },
  "top.txt": { kind: "file", node: file("top") },
});

describe("readFromFsa", () => {
  it("läser en nästlad fil → Blob", async () => {
    const blob = await readFromFsa(root, "/documents/text/d1.txt");
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("hello");
  });

  it("läser en fil på rot-nivå (ingen mapp-traversering)", async () => {
    const blob = await readFromFsa(root, "top.txt");
    expect(await blob!.text()).toBe("top");
  });

  it("tom path → null", async () => {
    expect(await readFromFsa(root, "/")).toBeNull();
    expect(await readFromFsa(root, "")).toBeNull();
  });

  it("saknad mellanliggande mapp → null", async () => {
    expect(await readFromFsa(root, "documents/saknas/x.txt")).toBeNull();
  });

  it("saknad fil i existerande mapp → null", async () => {
    expect(await readFromFsa(root, "documents/text/saknas.txt")).toBeNull();
  });
});
