/**
 * Golden-filer för byråns fakturamall (#2255; före det standardmallen, #2251,
 * ADR 0042): fakturans exakta utseende låst på ritoperationsnivå.
 *
 * Jämförelsen är på ritoperationsnivå (`pdfDrawingOps`): varje text med
 * teckensnitt, storlek, färg och position, varje linje med tjocklek och färg,
 * varje fylld yta och varje bild — i ritordning, sida för sida — plus titel,
 * ämne och sidstorlek. Golden-filerna i `test/fixtures/faktura-golden/` är
 * läsbara: en rad per ritoperation, texten avkodad (svepen lagras som en hash
 * per längd). Fixturerna: slutfaktura och flersidig (med specifikationssidor),
 * aconto med självrisk-avräkning och öresutjämning, kredit, rådgivning och en
 * självrisk-nedbrytning sparad före avräkningstabellen.
 *
 * Ändras fakturans layout med avsikt: kör `UPDATE_GOLDEN=1 bun test
 * test/unit/lib/documents/faktura-golden.test.ts` och granska diffen.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";
import { z } from "zod";
import { renderFakturaPdf } from "@/lib/client/documents/faktura-pdf";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { expenseSweep, FAKTURA_FIXTURES, timeSweep } from "../../../helpers/faktura-fixtures";
import { pdfDrawingOps } from "../../../helpers/pdf-text";

const GOLDEN_DIR = join(import.meta.dir, "../../../fixtures/faktura-golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** Det som jämförs: metadata, sidstorlekar och ritoperationerna per sida. */
interface Golden {
  title: string;
  subject: string;
  pageSizes: Array<[number, number]>;
  pages: string[][];
}

async function goldenOf(bytes: Uint8Array): Promise<Golden> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  return {
    title: doc.getTitle() ?? "",
    subject: doc.getSubject() ?? "",
    pageSizes: doc.getPages().map((p): [number, number] => [p.getWidth(), p.getHeight()]),
    pages: await pdfDrawingOps(bytes),
  };
}

/** Jämför mot golden-filen `name` — eller skriv den med `UPDATE_GOLDEN=1`. */
function expectGolden(name: string, actual: unknown): void {
  const file = join(GOLDEN_DIR, `${name}.json`);
  if (UPDATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(actual, null, 1)}\n`);
  }
  expect(actual).toEqual(parseJsonWith(z.unknown(), readFileSync(file, "utf8")));
}

const hash = (g: Golden): string => createHash("sha256").update(JSON.stringify(g)).digest("hex");

describe("byråns fakturamall — låst utseende (#2255)", () => {
  for (const [name, fixture] of Object.entries(FAKTURA_FIXTURES)) {
    it(`${name}: samma ritoperationer, sidor och metadata`, async () => {
      const actual = await goldenOf(await renderFakturaPdf(fixture()));
      expect(actual.pages.flat().length).toBeGreaterThan(20);
      expectGolden(name, actual);
    });
  }

  it("sidbrytningarna: utläggslistor med 30–75 poster bryts på låsta ställen", async () => {
    const hashes: Record<string, string> = {};
    for (let n = 30; n <= 75; n++) {
      const actual = await goldenOf(await renderFakturaPdf(expenseSweep(n)));
      hashes[String(n)] = hash(actual);
    }
    expectGolden("sweep-utlagg", hashes);
  });

  it("sidbrytningarna: tidslistor med 20–60 poster bryts på låsta ställen", async () => {
    const hashes: Record<string, string> = {};
    for (let n = 20; n <= 60; n++) {
      const actual = await goldenOf(await renderFakturaPdf(timeSweep(n)));
      hashes[String(n)] = hash(actual);
    }
    expectGolden("sweep-tid", hashes);
  });
});
