/**
 * pdfjs i den kompilerade server-binären (#1156, #1252) hänger på två interna
 * detaljer i pdfjs: att `globalThis.pdfjsWorker` kör workern i samma tråd, och
 * att `DOMMatrix` bara behövs som klass vid textutvinning (se
 * `pdfjs-server-runtime.ts`). Båda kan ändras i vilken version som helst, så:
 *   - versionen är låst EXAKT (en caret skulle låta `bun install` byta den tyst),
 *   - Dependabot uppgraderar pdfjs i en EGEN PR, aldrig gömd i minor/patch-
 *     gruppen — där syns binärtestet (`pdf-extract-compiled.test.ts`) för just
 *     den bytningen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";

const root = join(__dirname, "..", "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const dependabot = readFileSync(join(root, ".github", "dependabot.yml"), "utf8");

/** Rotmanifestets block i dependabot.yml (fram till nästa `- package-ecosystem`). */
function rootNpmBlock(): string {
  const start = dependabot.indexOf('directory: "/"\n');
  const end = dependabot.indexOf("- package-ecosystem", start);
  return dependabot.slice(start, end === -1 ? undefined : end);
}

describe("pdfjs-dist är låst (#1252)", () => {
  it("exakt version — ingen caret eller tilde", () => {
    expect(pkg.dependencies["pdfjs-dist"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("Dependabot: pdfjs-dist uppgraderas i en egen grupp, utesluten ur minor/patch-gruppen", () => {
    const block = rootNpmBlock();
    expect(block).toMatch(/pdfjs:\s*\n\s*patterns:\s*\["pdfjs-dist"\]/);
    expect(block).toMatch(/npm-minor-patch:[\s\S]*exclude-patterns:\s*\["pdfjs-dist"\]/);
  });
});
