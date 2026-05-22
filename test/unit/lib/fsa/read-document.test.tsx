/**
 * Test för hjälpfunktionen som läser ett dokument från FSA till en Blob.
 * Vi exporterar inte readFromFsa direkt — vi testar via reverse-walking
 * en in-memory FSA-tree:n och bekräftar att rätt bytes returneras.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { makeFakeFsa } from "../../../helpers/fake-fsa";
import { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";

// Vi testar samma walk-pattern som readFromFsa i _document-row.tsx
// genom att direkt anropa getDirectoryHandle/getFileHandle.
async function readFromFsa(handle: FileSystemDirectoryHandle, path: string): Promise<Blob | null> {
  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dir: FileSystemDirectoryHandle = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]); }
    catch { return null; }
  }
  try {
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch { return null; }
}

describe("readFromFsa", () => {
  it("returnerar Blob med rätt bytes för en existerande fil", async () => {
    const fsa = makeFakeFsa();
    const fs = new FsaIsoGitAdapter(fsa.root);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    await fs.writeFile("/documents/content/d-1.pdf", bytes);

    const blob = await readFromFsa(fsa.root, "documents/content/d-1.pdf");
    expect(blob).not.toBeNull();
    const buf = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(bytes));
  });

  it("returnerar null om fil saknas", async () => {
    const fsa = makeFakeFsa();
    const blob = await readFromFsa(fsa.root, "documents/content/missing.pdf");
    expect(blob).toBeNull();
  });

  it("returnerar null om katalog längs vägen saknas", async () => {
    const fsa = makeFakeFsa();
    const blob = await readFromFsa(fsa.root, "nonexistent/dir/file.pdf");
    expect(blob).toBeNull();
  });

  it("strippar leading slash i path", async () => {
    const fsa = makeFakeFsa();
    const fs = new FsaIsoGitAdapter(fsa.root);
    await fs.writeFile("/x.txt", new TextEncoder().encode("hello"));

    const blob = await readFromFsa(fsa.root, "/x.txt");
    expect(blob).not.toBeNull();
  });
});
