/**
 * #1578: version och datum ur git vid bygget. Köraren injiceras, så testet
 * behöver varken git eller taggar; misslyckas git blir värdena tomma.
 */
import { describe, expect, it } from "vitest-compat";
import { readBuildVersion, runGit, type GitRunner } from "../../../tooling/scripts/build-version";

/** Fejkad git: svarar ur tabellen (nyckel = argumenten), annars `null`. */
function fakeGit(answers: Record<string, string>): GitRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (args: readonly string[]): string | null => {
    const key = args.join(" ");
    calls.push(key);
    return answers[key] ?? null;
  };
  return Object.assign(run, { calls });
}

describe("readBuildVersion", () => {
  it("lyckat anrop: `git describe --tags` + HEAD:s commit-datum", () => {
    const git = fakeGit({
      "describe --tags": "v0.7.11-3-gabc1234",
      "log -1 --format=%cI HEAD": "2026-11-13T08:16:45+01:00",
    });
    expect(readBuildVersion(git)).toEqual({ version: "v0.7.11-3-gabc1234", date: "2026-11-13T08:16:45+01:00" });
  });

  it("misslyckad describe (inga taggar, ingen git): tomma värden, inget kast, inget datumanrop", () => {
    const git = fakeGit({});
    expect(readBuildVersion(git)).toEqual({ version: "", date: "" });
    expect(git.calls).toEqual(["describe --tags"]);
  });

  it("misslyckat datum: versionen finns, datumet blir tomt", () => {
    expect(readBuildVersion(fakeGit({ "describe --tags": "v0.7.11" }))).toEqual({ version: "v0.7.11", date: "" });
  });

  it("AVA_VERSION i miljön vinner över git (produktionen bygger utan git)", () => {
    const git = fakeGit({ "describe --tags": "v0.0.1" });
    expect(readBuildVersion(git, { AVA_VERSION: " v0.7.12 ", AVA_VERSION_DATE: "2026-11-14T01:45:00Z" })).toEqual({ version: "v0.7.12", date: "2026-11-14T01:45:00Z" });
    expect(git.calls).toEqual([]);
    expect(readBuildVersion(git, { AVA_VERSION: "v0.7.12" })).toEqual({ version: "v0.7.12", date: "" });
  });

  it("tom AVA_VERSION räknas inte: git används", () => {
    expect(readBuildVersion(fakeGit({ "describe --tags": "v0.7.11" }), { AVA_VERSION: "  " })).toEqual({ version: "v0.7.11", date: "" });
  });

  it("standardköraren kastar aldrig och ger strängar", () => {
    const v = readBuildVersion();
    expect(typeof v.version).toBe("string");
    expect(typeof v.date).toBe("string");
  });
});

describe("runGit", () => {
  it("lyckat kommando → trimmad stdout", () => {
    expect(runGit(["--version"])).toMatch(/^git version \S+$/);
  });

  it("misslyckat kommando → null (inget kast, ingen utskrift)", () => {
    expect(runGit(["inget-sådant-kommando"])).toBeNull();
  });
});
