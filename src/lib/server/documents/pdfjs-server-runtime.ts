/**
 * Gör pdfjs användbart i den kompilerade server-binären (#1156).
 *
 * `bun build --compile` (server-first) tar inte med två saker pdfjs räknar med
 * i Node, så PDF-texten blev tom och klassificeringen fick inget att gå på:
 *
 *  - `DOMMatrix`: pdfjs försöker skapa den via den native modulen
 *    `@napi-rs/canvas`, som inte bundlas → "DOMMatrix is not defined".
 *    Textutvinning renderar aldrig, så en minimal klass räcker.
 *  - worker-modulen: pdfjs laddar `./pdf.worker.mjs` dynamiskt, vilket inte
 *    finns i binären. Med `globalThis.pdfjsWorker` satt kör pdfjs worker-koden
 *    i samma tråd — den statiska importen nedan gör att bun bundlar in den.
 *
 * Bara servern: i webbläsaren ska workern köra i en egen tråd (extract-text.ts
 * sätter `workerSrc` där).
 */

import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

/** Minimal 2D-matris — pdfjs behöver klassen, textutvinning använder den inte. */
class MinimalDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: readonly number[]) {
    if (init?.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
  }
}

/** Idempotent; anropas innan server-sidan extraherar text ur en PDF. */
export function preparePdfjsForServer(): void {
  const g = globalThis as { DOMMatrix?: unknown; pdfjsWorker?: unknown };
  g.DOMMatrix ??= MinimalDOMMatrix;
  g.pdfjsWorker ??= pdfjsWorker;
}
