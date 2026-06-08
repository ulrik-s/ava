/**
 * Tester för generate-demo-manifest:s scan-paths. Vi vill säkerställa att
 * alla aktuella entity-mappar är inkluderade — annars 404:ar UI:n när
 * den fetchar t.ex. /payment-plans/.json.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";

describe("generate-demo-manifest", () => {
  const TMP = resolve(tmpdir(), `manifest-test-${Date.now()}`);

  function writeStubs(): void {
    // Skriv en stub-fil i varje entity-prefix så manifestet borde plocka upp alla
    for (const entry of Object.values(ENTITY_REGISTRY)) {
      const full = resolve(TMP, entry.gitPrefix, "stub.json");
      mkdirSync(resolve(full, ".."), { recursive: true });
      writeFileSync(full, JSON.stringify({ id: "stub", organizationId: "x" }));
    }
  }

  function runScript(): { paths: string[]; generatedAt: string; version: number } {
    execFileSync("bun", ["tooling/scripts/generate-demo-manifest.ts", TMP], {
      cwd: resolve(__dirname, "..", "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(readFileSync(resolve(TMP, "manifest.json"), "utf8"));
  }

  it("plockar upp ALLA entity-mappar från ENTITY_REGISTRY", () => {
    rmSync(TMP, { recursive: true, force: true });
    writeStubs();
    const manifest = runScript();
    rmSync(TMP, { recursive: true, force: true });

    // Varje gitPrefix borde ha exakt en stub.json i manifestet
    const expectedPrefixes = new Set(
      Object.values(ENTITY_REGISTRY).map((e) => e.gitPrefix),
    );
    const seenPrefixes = new Set<string>();
    for (const p of manifest.paths) {
      // Ta första-N-segment som matchar ett expected prefix
      for (const prefix of expectedPrefixes) {
        if (p.startsWith(prefix + "/")) seenPrefixes.add(prefix);
      }
    }
    for (const prefix of expectedPrefixes) {
      expect(seenPrefixes.has(prefix)).toBe(true);
    }
  });
});
