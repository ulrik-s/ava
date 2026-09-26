/**
 * Entry som kompileras till en bun-binär av pdf-extract-compiled.test.ts —
 * samma förutsättningar som server-first-binären. Skriver ut antal sidor och
 * texten per sida (`|`-separerad).
 */
import { readFileSync } from "node:fs";
import { preparePdfjsForServer } from "@/lib/server/documents/pdfjs-server-runtime";
import { extractPages } from "@/lib/shared/extract-text";

const path = process.argv[2];
if (!path) throw new Error("usage: probe <file.pdf>");
if (process.argv[3] !== "--no-prepare") preparePdfjsForServer();
const pages = await extractPages({ bytes: new Uint8Array(readFileSync(path)), mimeType: "application/pdf" });
const text = pages.map((p) => p.replace(/\s+/g, " ").trim()).join(" | ");
process.stdout.write(`PAGES:${pages.length}\nTEXT:${text}\n`);
