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

/** Minimal giltig PDF med en rad text (Helvetica), med korrekt xref. */
function minimalPdf(text: string): string {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objs.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

let dir = "";
let bin = "";
let pdf = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-pdf-"));
  bin = join(dir, "probe");
  pdf = join(dir, "doc.pdf");
  writeFileSync(pdf, minimalPdf("Stamningsansokan tingsratt"));
  const build = spawnSync("bun", ["build", "--compile", "test/integration/fixtures/pdf-extract-probe.ts", "--outfile", bin], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(`bun build --compile misslyckades:\n${build.stderr}`);
}, 120_000);

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const run = (...args: string[]): string => spawnSync(bin, [pdf, ...args], { encoding: "utf8" }).stdout;

describe("PDF-text i kompilerad binär (#1156)", () => {
  it("med server-förberedelsen: texten kommer ut", () => {
    expect(run()).toContain("TEXT:Stamningsansokan tingsratt");
  }, 60_000);

  it("utan förberedelsen: tom text (felet testet vaktar mot)", () => {
    expect(run("--no-prepare")).toContain("TEXT:\n");
  }, 60_000);
});
