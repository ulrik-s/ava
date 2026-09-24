/**
 * Entry som kompileras till en bun-binär av pdf-extract-compiled.test.ts —
 * samma förutsättningar som server-first-binären. Skriver ut extraherad text.
 */
import { readFileSync } from "node:fs";
import { preparePdfjsForServer } from "@/lib/server/documents/pdfjs-server-runtime";
import { extractText } from "@/lib/shared/extract-text";

const path = process.argv[2];
if (!path) throw new Error("usage: probe <file.pdf>");
if (process.argv[3] !== "--no-prepare") preparePdfjsForServer();
const text = await extractText({ bytes: new Uint8Array(readFileSync(path)), mimeType: "application/pdf" });
process.stdout.write(`TEXT:${text.replace(/\s+/g, " ").trim()}\n`);
