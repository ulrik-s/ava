/**
 * Uppstartsfyllningarna (#2177): registret (namn, ägar-issue, slutdatum) och
 * runnern. En post vars `removeBy` har passerats fäller testet, så en gammal
 * fyllning tvingas bort i stället för att köras vid varje start för alltid.
 */
import { describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import {
  runStartupBackfills, STARTUP_BACKFILLS, type StartupBackfill, type StartupBackfillDeps,
} from "@/lib/server/jobs/startup-backfills";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-a");
const repos = buildInMemoryRepositories(new LocalStore(prebakeJoins({ organizations: [{ id: ORG, name: "Byrån", matterTypes: [] }] }), async () => {}));
const deps = { repos, organizationIds: [ORG] };

/** Dagens datum som `YYYY-MM-DD` (UTC). */
const today = (): string => new Date().toISOString().slice(0, 10);

function backfill(name: string, run: StartupBackfill["run"]): StartupBackfill {
  return { name, run, ownerIssue: "ulrik-s/ava#2177", removeBy: "2099-12-31" };
}

describe("STARTUP_BACKFILLS", () => {
  it.each(STARTUP_BACKFILLS.map((b) => [b.name, b] as const))("%s har inte passerat sitt slutdatum — ta bort den", (_name, b) => {
    expect(b.removeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(b.removeBy))).toBe(false);
    expect(b.removeBy >= today()).toBe(true);
  });

  it("varje post har ett unikt namn och ett ägar-issue", () => {
    const names = STARTUP_BACKFILLS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    for (const b of STARTUP_BACKFILLS) {
      expect(b.ownerIssue).toMatch(/^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+|[\w.-]+\/[\w.-]+#\d+)$/);
    }
  });

  it("registret kör dokumenttyper, offentligt uppdrag och kundförlust mot byrån", async () => {
    const lines: string[] = [];
    await runStartupBackfills({ deps, log: (m) => lines.push(m) });
    expect(lines.filter((l) => l.includes(": klar — "))).toEqual([
      "uppstartsfyllning dokumenttyper: klar — 0 dokument, 0 byråer flyttade, 0 fel",
      "uppstartsfyllning offentligt uppdrag: klar — 1 byråer uppdaterade, 0 fel",
      "uppstartsfyllning kundförlust: klar — 0 avskrivningsposter skapade, 0 fel",
    ]);
    expect((await repos.organizations.getById(ORG))?.publicAssignmentMatterTypes).toHaveLength(4);
  });
});

describe("runStartupBackfills", () => {
  it("loggar start och resultat, och fel per rad med fyllningens namn", async () => {
    const lines: string[] = [];
    let seen: StartupBackfillDeps | undefined;
    const ok = backfill("prov", (d) => {
      seen = d;
      d.onError("rad 7: trasig");
      return Promise.resolve("3 rader");
    });
    await runStartupBackfills({ deps, log: (m) => lines.push(m), backfills: [ok] });
    expect(lines).toEqual([
      "uppstartsfyllning prov: startar (tas bort senast 2099-12-31, ulrik-s/ava#2177)",
      "uppstartsfyllning prov: rad 7: trasig",
      "uppstartsfyllning prov: klar — 3 rader",
    ]);
    expect(seen?.repos).toBe(repos);
    expect(seen?.organizationIds).toEqual([ORG]);
  });

  it("en fyllning som kastar loggas och stoppar inte nästa; runnern avvisas aldrig", async () => {
    const lines: string[] = [];
    const order: string[] = [];
    const broken = backfill("trasig", () => { order.push("trasig"); return Promise.reject(new Error("db borta")); });
    const next = backfill("nästa", () => { order.push("nästa"); return Promise.resolve("klart"); });
    await expect(runStartupBackfills({ deps, log: (m) => lines.push(m), backfills: [broken, next] })).resolves.toBeUndefined();
    expect(order).toEqual(["trasig", "nästa"]);
    expect(lines).toContain("uppstartsfyllning trasig: misslyckades — Error: db borta");
    expect(lines).toContain("uppstartsfyllning nästa: klar — klart");
  });

  it("en fyllning som kastar synkront fångas också", async () => {
    const lines: string[] = [];
    const sync = backfill("synk", () => { throw new Error("direkt"); });
    await runStartupBackfills({ deps, log: (m) => lines.push(m), backfills: [sync] });
    expect(lines.at(-1)).toBe("uppstartsfyllning synk: misslyckades — Error: direkt");
  });
});
