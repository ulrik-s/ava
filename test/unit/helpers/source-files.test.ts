import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest-compat";
import { sourceFiles } from "../../helpers/source-files";

describe("sourceFiles", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("hittar matchande filer rekursivt och hoppar över kataloger och andra filer", () => {
    root = mkdtempSync(join(tmpdir(), "source-files-"));
    mkdirSync(join(root, "a", "b.tsx"), { recursive: true });
    writeFileSync(join(root, "top.ts"), "");
    writeFileSync(join(root, "a", "inner.tsx"), "");
    writeFileSync(join(root, "a", "notes.md"), "");
    expect(sourceFiles(root, /\.tsx?$/).sort()).toEqual([join(root, "a", "inner.tsx"), join(root, "top.ts")]);
  });
});
