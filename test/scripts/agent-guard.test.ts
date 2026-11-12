/**
 * Agentvakten: agent-PR:er stoppas vid skyddade sökvägar, destruktiva
 * migrationer och fler än tio per dygn — vanliga PR:er påverkas aldrig.
 */
import { describe, expect, it } from "vitest-compat";
import { AGENT_PR_PER_DAY, addedMigrationLines, baselineDiffTightens, FILE_SIZE_BASELINE, guardViolations, type GuardInput } from "../../tooling/scripts/agent-guard";

const BASE: GuardInput = { labels: ["agent-pr", "granskad"], files: ["src/app/matters/page.tsx"], addedMigrationLines: [], agentPrsLast24h: 1 };

describe("guardViolations", () => {
  it("vanlig PR (utan agent-pr) passerar alltid", () => {
    expect(guardViolations({ ...BASE, labels: [], files: [".github/workflows/ci.yml"], agentPrsLast24h: 99 })).toEqual([]);
  });

  it("agent-PR i appkod passerar", () => {
    expect(guardViolations(BASE)).toEqual([]);
  });

  it.each([".github/workflows/ci.yml", "tooling/scripts/deploy-prod.sh", "src/lib/server/auth/principal.ts", "tooling/agents/3-implementation.md", "package.json", "tooling/scripts/arch-metrics.ts", ".claude/settings.json"])(
    "skyddad sökväg %s stoppas", (file) => {
      expect(guardViolations({ ...BASE, files: [file] })).toEqual([expect.stringContaining(file)]);
    },
  );

  it.each(["DROP TABLE x;", "ALTER TABLE x RENAME COLUMN a TO b;", "DELETE FROM users;", "ALTER TABLE x ALTER COLUMN a TYPE int;", "TRUNCATE x;"])(
    "destruktiv migration stoppas: %s", (line) => {
      expect(guardViolations({ ...BASE, addedMigrationLines: [line] })).toHaveLength(1);
    },
  );

  it("additiv migration passerar", () => {
    expect(guardViolations({ ...BASE, addedMigrationLines: ["ALTER TABLE x ADD COLUMN IF NOT EXISTS y text;"] })).toEqual([]);
  });

  it("människa-godkänd släpper skyddade sökvägar och migrationer, men inte taket", () => {
    const input = { ...BASE, labels: ["agent-pr", "granskad", "människa-godkänd"], files: [".github/x.yml"], addedMigrationLines: ["DROP TABLE x;"] };
    expect(guardViolations(input)).toEqual([]);
    expect(guardViolations({ ...input, agentPrsLast24h: AGENT_PR_PER_DAY + 1 })).toHaveLength(1);
  });

  it(`tak: nr ${AGENT_PR_PER_DAY} passerar, nr ${AGENT_PR_PER_DAY + 1} stoppas`, () => {
    expect(guardViolations({ ...BASE, agentPrsLast24h: AGENT_PR_PER_DAY })).toEqual([]);
    expect(guardViolations({ ...BASE, agentPrsLast24h: AGENT_PR_PER_DAY + 1 })).toEqual([expect.stringContaining("Taket")]);
  });
});

describe("granskning krävs", () => {
  it("ogranskad agent-PR stoppas", () => {
    expect(guardViolations({ ...BASE, labels: ["agent-pr", "att-granska"] })).toEqual([expect.stringContaining("granskad")]);
  });

  it("blockerad stoppas även om den är granskad", () => {
    expect(guardViolations({ ...BASE, labels: ["agent-pr", "granskad", "blockerad"] })).toEqual([expect.stringContaining("Blockerad")]);
  });
});

describe("filstorleksbaslinjen", () => {
  const head = (body: string[]) => [`--- a/${FILE_SIZE_BASELINE}`, `+++ b/${FILE_SIZE_BASELINE}`, ...body].join("\n");

  it("sänkt radantal och borttagen rad: strängare → tillåtet för agenten", () => {
    const diff = head(['-  "src/a.ts": 520,', '+  "src/a.ts": 480,', '-  "src/b.ts": 410,']);
    expect(baselineDiffTightens(diff)).toBe(true);
    expect(guardViolations({ ...BASE, files: [FILE_SIZE_BASELINE], baselineOnlyTightens: true })).toEqual([]);
  });

  it("höjt radantal eller ny fil: luckras upp → skyddad sökväg", () => {
    expect(baselineDiffTightens(head(['-  "src/a.ts": 480,', '+  "src/a.ts": 520,']))).toBe(false);
    expect(baselineDiffTightens(head(['+  "src/ny.ts": 450,']))).toBe(false);
    expect(guardViolations({ ...BASE, files: [FILE_SIZE_BASELINE], baselineOnlyTightens: false })).toEqual([expect.stringContaining(FILE_SIZE_BASELINE)]);
  });

  it("rader i andra filer räknas inte; ingen ändring alls är strängt nog", () => {
    expect(baselineDiffTightens(["+++ b/src/x.ts", '+  "src/a.ts": 999,'].join("\n"))).toBe(true);
    expect(baselineDiffTightens("")).toBe(true);
  });

  it("spärrskriptet själv är skyddat", () => {
    expect(guardViolations({ ...BASE, files: ["tooling/scripts/file-size-ratchet.ts"] })).toHaveLength(1);
  });
});

describe("addedMigrationLines", () => {
  it("bara tillagda rader i migrationsfiler", () => {
    const diff = [
      "+++ b/src/app/page.tsx",
      "+DROP TABLE nej;",
      "+++ b/tooling/db/migrations/0045_x.sql",
      "+ALTER TABLE a ADD COLUMN b text;",
      "-gammal rad",
      " oförändrad",
    ].join("\n");
    expect(addedMigrationLines(diff)).toEqual(["ALTER TABLE a ADD COLUMN b text;"]);
  });
});
