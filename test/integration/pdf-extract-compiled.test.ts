/**
 * #1156: PDF-text i den KOMPILERADE server-binären. Felet (DOMMatrix saknas,
 * worker-modulen bundlas inte) syns bara i `bun build --compile` — inte i
 * `bun test` — så testet kompilerar en liten binär och kör den.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { minimalPdf } from "../helpers/minimal-pdf";

let dir = "";
let bin = "";
let pdf = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-pdf-"));
  bin = join(dir, "probe");
  pdf = join(dir, "doc.pdf");
  writeFileSync(pdf, minimalPdf(["Stamningsansokan tingsratt", "Bilaga fullmakt"]));
  const build = spawnSync("bun", ["build", "--compile", "test/integration/fixtures/pdf-extract-probe.ts", "--outfile", bin], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(`bun build --compile misslyckades:\n${build.stderr}`);
}, 120_000);

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const run = (...args: string[]): string => spawnSync(bin, [pdf, ...args], { encoding: "utf8" }).stdout;

describe("PDF-text i kompilerad binär (#1156)", () => {
  it("med server-förberedelsen: texten kommer ut, en sträng per sida (#1215)", () => {
    const out = run();
    expect(out).toContain("PAGES:2");
    expect(out).toContain("TEXT:Stamningsansokan tingsratt | Bilaga fullmakt");
  }, 60_000);

  it("utan förberedelsen: tom text (felet testet vaktar mot)", () => {
    expect(run("--no-prepare")).toContain("PAGES:0\nTEXT:\n");
  }, 60_000);
});
