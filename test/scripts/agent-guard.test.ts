/**
 * Agentvakten: agent-PR:er stoppas vid skyddade sökvägar, destruktiva
 * migrationer och fler än taket per dygn — vanliga PR:er påverkas aldrig.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import {
  AGENT_PR_PER_DAY, addedMigrationLines, baselineDiffTightens, cappedCreatedAts, countsTowardCap, FILE_SIZE_BASELINE, ROUTER_SIZE_BASELINE,
  guardViolations, type GuardInput, humanApproved, rankInLast24h, trustedLabels,
} from "../../tooling/scripts/agent-guard";

const BASE: GuardInput = { labels: ["agent-pr", "granskad"], files: ["src/app/matters/page.tsx"], addedMigrationLines: [], agentPrsLast24h: 1 };

describe("rankInLast24h (#1954)", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const h = (hoursAgo: number): string => new Date(now - hoursAgo * 3_600_000).toISOString();

  it("räknar PR:er de senaste 24 h från nu, till och med den här", () => {
    const created = Date.parse(h(2));
    expect(rankInLast24h([h(30), h(20), h(5), h(2), h(1)], created, now)).toBe(3);
  });

  it("en PR som var över taket går igenom när dygnet gått", () => {
    const old = Array.from({ length: 25 }, (_, i) => h(30 + i / 10));
    expect(rankInLast24h(old, Date.parse(h(30)), now)).toBe(0);
  });
});

describe("dygnstaket räknar bara det som kan mergas (2026-11-27)", () => {
  const pull = (number: number, state: string, merged: boolean, labels: string[] = []) =>
    ({ number, createdAt: `2026-11-26T1${number}:00:00Z`, state, merged, labels });

  it("mergad och öppen räknas; blockerad och stängd utan merge räknas inte", () => {
    expect(countsTowardCap(pull(1, "MERGED", true))).toBe(true);
    expect(countsTowardCap(pull(2, "OPEN", false, ["agent-pr", "granskad"]))).toBe(true);
    expect(countsTowardCap(pull(3, "OPEN", false, ["agent-pr", "granskad", "blockerad"]))).toBe(false);
    expect(countsTowardCap(pull(4, "CLOSED", false))).toBe(false);
    expect(countsTowardCap(pull(5, "closed", true))).toBe(true); // sökningens gemener, mergad
  });

  it("PR:en som prövas räknas alltid själv, också när den är blockerad", () => {
    const pulls = [pull(1, "MERGED", true), pull(2, "OPEN", false, ["blockerad"]), pull(3, "CLOSED", false), pull(4, "OPEN", false, ["blockerad"])];
    expect(cappedCreatedAts(pulls, 4)).toEqual(["2026-11-26T11:00:00Z", "2026-11-26T14:00:00Z"]);
  });

  it("sju blockerade PR:er bland 37 släpper under taket", () => {
    const now = Date.parse("2026-11-26T22:00:00Z");
    const at = (i: number): string => new Date(now - (37 - i) * 600_000).toISOString();
    const pulls = Array.from({ length: 37 }, (_, i) => ({ number: i + 1, createdAt: at(i), state: "OPEN", merged: false, labels: i < 7 ? ["blockerad"] : [] }));
    const self = pulls.at(-1);
    expect(rankInLast24h(pulls.map((p) => p.createdAt), Date.parse(self?.createdAt ?? ""), now)).toBe(37);
    expect(rankInLast24h(cappedCreatedAts(pulls, self?.number ?? 0), Date.parse(self?.createdAt ?? ""), now)).toBe(AGENT_PR_PER_DAY);
  });
});

describe("guardViolations", () => {
  it("vanlig PR (utan agent-pr) passerar alltid", () => {
    expect(guardViolations({ ...BASE, labels: [], files: [".github/workflows/ci.yml"], agentPrsLast24h: 99 })).toEqual([]);
  });

  it("agent-PR i appkod passerar", () => {
    expect(guardViolations(BASE)).toEqual([]);
  });

  it.each([".github/workflows/ci.yml", "tooling/scripts/deploy-prod.sh", "src/lib/server/auth/principal.ts", "tooling/agents/3-implementation.md", "package.json", "tooling/scripts/arch-metrics.ts", ".claude/settings.json", "tooling/scripts/flow-guard.ts", "tooling/scripts/flow/transition.ts"])(
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

/** Pengalogik, delade scheman och migrationer (#1873): en fil per ny post i PROTECTED_PATHS. */
const MONEY_FILES = [
  "src/lib/shared/schemas/invoice.ts",
  "tooling/db/migrations/0042_x.sql",
  "tooling/db/migrations/meta/_journal.json",
  "src/lib/server/billing/x.ts",
  "src/lib/shared/billing/billing-flow.ts",
  "src/lib/shared/billing/kostnadsrakning.ts",
  "src/lib/shared/billing/kostnadsrakning-flow.ts",
  "src/lib/shared/billing/coverage-billing.ts",
  "src/lib/shared/billing/invoice-calc.ts",
  "src/lib/server/routers/invoice.ts",
  "src/lib/server/routers/billingRun.ts",
  "src/lib/server/routers/billingRun/x.ts",
  "src/lib/shared/billing/vat.ts",
  "src/lib/shared/billing/invoice-vat.ts",
  "src/lib/shared/billing/expense-vat.ts",
  "src/lib/shared/billing/acconto-vat.ts",
  "src/lib/shared/billing/brottmalstaxa.ts",
  "src/lib/shared/billing/forordnandetaxa.ts",
  "src/lib/shared/accounting/voucher.ts",
];

describe("pengalogik, delade scheman och migrationer (#1873)", () => {
  it.each(MONEY_FILES)("%s stoppas utan människa-godkänd och passerar med den", (file) => {
    expect(guardViolations({ ...BASE, files: [file] })).toEqual([expect.stringContaining(`Skyddad sökväg: ${file} `)]);
    expect(guardViolations({ ...BASE, labels: [...BASE.labels, "människa-godkänd"], files: [file] })).toEqual([]);
  });

  it("en migrationsfil med bara en additiv rad stoppas utan människa-godkänd", () => {
    const input = { ...BASE, files: ["tooling/db/migrations/0099_x.sql"], addedMigrationLines: ["ALTER TABLE x ADD COLUMN IF NOT EXISTS y text;"] };
    expect(guardViolations(input)).toEqual([expect.stringContaining("Skyddad sökväg: tooling/db/migrations/0099_x.sql ")]);
  });

  it.each([
    "src/lib/server/routers/invoiceDispatch.ts",
    "src/lib/server/routers/billingRunX.ts",
    "src/lib/shared/vat-rates.ts",
    "src/lib/shared/invoice-vat-view.tsx",
    "src/lib/shared/billing/x.ts",
    "src/lib/server/billing.ts",
  ])("närliggande fil %s passerar", (file) => {
    expect(guardViolations({ ...BASE, files: [file] })).toEqual([]);
  });

  it("CODEOWNERS listar samma sökvägar med @ulrik-s", () => {
    const owners = readFileSync(join(process.cwd(), ".github/CODEOWNERS"), "utf8");
    const entries = [
      "/src/lib/shared/schemas/", "/tooling/db/migrations/", "/src/lib/server/billing/",
      "/src/lib/shared/billing/billing-*.ts", "/src/lib/shared/billing/kostnadsrakning*.ts", "/src/lib/shared/billing/coverage-billing.ts",
      "/src/lib/shared/billing/invoice-calc.ts", "/src/lib/server/routers/invoice.ts", "/src/lib/server/routers/billingRun.ts",
      "/src/lib/server/routers/billingRun/", "/src/lib/shared/billing/vat.ts", "/src/lib/shared/billing/invoice-vat.ts",
      "/src/lib/shared/billing/expense-vat.ts", "/src/lib/shared/billing/acconto-vat.ts", "/src/lib/shared/billing/brottmalstaxa.ts",
      "/src/lib/shared/billing/forordnandetaxa.ts", "/src/lib/shared/accounting/",
    ];
    const rows = owners.split("\n").map((line) => line.trim().split(/\s+/));
    for (const entry of entries) {
      expect(rows).toContainEqual([entry, "@ulrik-s"]);
    }
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

  it("routerbaslinjen (#2176) har samma undantag: bara skärpning släpps igenom", () => {
    const router = (body: string[]) => [`--- a/${ROUTER_SIZE_BASELINE}`, `+++ b/${ROUTER_SIZE_BASELINE}`, ...body].join("\n");
    expect(baselineDiffTightens(router(['-  "src/lib/server/routers/a.ts": 300,', '+  "src/lib/server/routers/a.ts": 280,']))).toBe(true);
    expect(baselineDiffTightens(router(['+  "src/lib/server/routers/ny.ts": 260,']))).toBe(false);
    expect(guardViolations({ ...BASE, files: [ROUTER_SIZE_BASELINE], baselineOnlyTightens: true })).toEqual([]);
    expect(guardViolations({ ...BASE, files: [ROUTER_SIZE_BASELINE], baselineOnlyTightens: false })).toEqual([expect.stringContaining(ROUTER_SIZE_BASELINE)]);
  });

  it("en uppluckrad baslinje fäller hela diffen, även när den andra skärps", () => {
    const both = [
      `--- a/${FILE_SIZE_BASELINE}`, `+++ b/${FILE_SIZE_BASELINE}`, '-  "src/a.ts": 520,', '+  "src/a.ts": 480,',
      `--- a/${ROUTER_SIZE_BASELINE}`, `+++ b/${ROUTER_SIZE_BASELINE}`, '+  "src/lib/server/routers/ny.ts": 260,',
    ].join("\n");
    expect(baselineDiffTightens(both)).toBe(false);
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

describe("människa-godkänd måste vara satt av Ulrik själv", () => {
  const ev = (event: string, actor = "ulrik-s", viaApp = false) => ({ event, label: "människa-godkänd", actor, viaApp });

  it("Ulrik själv: godkänd", () => {
    expect(humanApproved([ev("labeled")])).toBe(true);
  });

  it("satt via appen (en agent), av någon annan, eller borttagen: inte godkänd", () => {
    expect(humanApproved([ev("labeled", "ulrik-s", true)])).toBe(false);
    expect(humanApproved([ev("labeled", "någon")])).toBe(false);
    expect(humanApproved([ev("labeled"), ev("unlabeled")])).toBe(false);
    expect(humanApproved([])).toBe(false);
  });

  it("trustedLabels tar bort en etikett som en agent satt, och läser bara loggen när det behövs", () => {
    let reads = 0;
    const events = () => { reads++; return [ev("labeled", "ulrik-s", true)]; };
    expect(trustedLabels(["agent-pr", "granskad"], events)).toEqual(["agent-pr", "granskad"]);
    expect(reads).toBe(0);
    expect(trustedLabels(["agent-pr", "människa-godkänd"], events)).toEqual(["agent-pr"]);
    expect(trustedLabels(["agent-pr", "människa-godkänd"], () => [ev("labeled")])).toEqual(["agent-pr", "människa-godkänd"]);
  });
});
