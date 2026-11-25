/**
 * lint-staged-patchen (#1875): pre-commit-kroken (`bunx lint-staged`) vägrar
 * annars en git som rapporterar `git version 2.51.GIT` (ingen numerisk patch-del).
 * Patchen gäller en exakt version, så en versionsbump som lämnar den efter
 * ska fälla CI i stället för att kroken tyst slutar fungera.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest-compat";

const read = (path: string): string => readFileSync(path, "utf8");
const match = (re: RegExp, text: string): string | undefined => re.exec(text)?.[1];

const locked = match(/"lint-staged": \["lint-staged@([^"]+)"/, read("bun.lock"));
const patched = /"patchedDependencies":\s*\{([^}]*)\}/.exec(read("package.json"))?.[1] ?? "";

/** `assertGitVersion` ur den installerade (patchade) lint-staged; den startar inte git. */
async function assertGitVersion(): Promise<(output: string) => boolean> {
  const file = join(process.cwd(), "node_modules/lint-staged/lib/assertGitVersion.js");
  const mod = (await import(pathToFileURL(file).href)) as { assertGitVersion: (output: string) => boolean };
  return mod.assertGitVersion;
}

describe("lint-staged-patchen", () => {
  it("patchedDependencies gäller den version bun.lock löser till, och patchfilen finns", () => {
    expect(locked).toMatch(/^\d+\.\d+\.\d+$/);
    const file = match(new RegExp(`"lint-staged@${locked ?? ""}":\\s*"([^"]+)"`), patched);
    expect(file).toBe(`patches/lint-staged@${locked ?? ""}.patch`);
    expect(existsSync(file ?? "")).toBe(true);
  });

  it("en git utan patch-del godtas, en för gammal git avvisas", async () => {
    const accepts = await assertGitVersion();
    expect(accepts("git version 2.51.GIT")).toBe(true);
    expect(accepts("git version 2.54.0")).toBe(true);
    expect(accepts("git version 2.31.0")).toBe(false);
  });
});
