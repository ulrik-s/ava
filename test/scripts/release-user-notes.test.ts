/**
 * "Nytt i AVA" (#2010) när taggen sätts: PR:ernas rad för användarna mellan
 * förra taggen och den här blir releasens avsnitt.
 */
import { describe, expect, it } from "vitest-compat";
import { RELEASE_NOTES_HEADING } from "@/lib/shared/release-notes";
import { prNumbers, type Run, userNotesFor } from "../../tooling/scripts/release-user-notes";

describe("prNumbers", () => {
  it("PR-numret sist i squash-commitarnas rubriker, äldst först", () => {
    expect(prNumbers(["fix: b (#12)", "chore: utan nummer", "feat: a (#10) "])).toEqual([10, 12]);
  });
});

describe("userNotesFor", () => {
  const bodies: Record<string, string> = {
    "repos/ulrik-s/ava/pulls/10": "**För användarna:** Ny knapp för att skicka fakturan.",
    "repos/ulrik-s/ava/pulls/12": "**För användarna:** —",
  };
  const fakeRun = (log: string, failing: readonly string[] = []): { run: Run; calls: string[] } => {
    const calls: string[] = [];
    const run: Run = (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "git" && args[0] === "describe") return "v0.7.54\n";
      if (cmd === "git") return log;
      const path = args[1] ?? "";
      if (failing.includes(path)) throw new Error("404");
      return bodies[path] ?? "";
    };
    return { run, calls };
  };

  it("samlar raderna från releasens PR:er; ett streck syns inte", () => {
    const { run, calls } = fakeRun("test: c (#13)\nfix: b (#12)\nfeat: a (#10)\n");
    expect(userNotesFor("v0.7.55", run)).toBe(`${RELEASE_NOTES_HEADING}\n\n- Ny knapp för att skicka fakturan.\n`);
    expect(calls).toContain("git describe --tags --abbrev=0 v0.7.55^");
    expect(calls).toContain("git log --format=%s v0.7.54..v0.7.55");
  });

  it("en PR som inte går att läsa hoppas över", () => {
    expect(userNotesFor("v0.7.55", fakeRun("feat: a (#10)\n", ["repos/ulrik-s/ava/pulls/10"]).run)).toBe("");
  });

  it("utan tidigare tagg blir det inget avsnitt", () => {
    const run: Run = () => { throw new Error("no names found"); };
    expect(userNotesFor("v0.0.1", run)).toBe("");
  });
});
