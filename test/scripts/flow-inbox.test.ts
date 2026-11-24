/**
 * Inkorgen för allt arbete: en issue i kodrepot utan arbetsorder-flagga är en
 * förfrågan i fel repo och flyttas till ava-feedback som `intern`. Arbetsorder
 * (L2), förslag och veckorapport (L5), PR:er och direkt arbete (nytt, eller med
 * en öppen PR) stannar.
 */
import { describe, expect, it } from "vitest-compat";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { GRACE_MS, markInternalParts, moveStrayIssues, orphanedParts, STAYS_IN_CODE_REPO, strayIssues } from "../../tooling/scripts/flow/inbox";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { decide } from "../../tooling/scripts/flow/transition";

const flow = loadFlow();
const NOW = Date.parse("2026-11-18T18:00:00Z");
const OLD = new Date(NOW - GRACE_MS - 60_000).toISOString();
const NEW = new Date(NOW - 10 * 60_000).toISOString();

const issue = (number: number, labels: string[], created = OLD, pr = false) =>
  ({ number, title: "t", body: "", labels: labels.map((name) => ({ name })), created_at: created, ...(pr ? { pull_request: {} } : {}) });
const open = [
  issue(5, ["bug"]), // förfrågan: flyttas (bugg)
  issue(6, ["agent-task"]), // arbetsorder: stannar
  issue(7, [], OLD, true), // PR: stannar
  issue(8, ["enhancement"]), // förfrågan: flyttas (förslag)
  issue(9, ["arkitektur-rapport"]), // veckorapport: stannar
  issue(10, ["bug"], NEW), // direkt arbete, för nytt: stannar
  issue(11, ["tooling"]), // direkt arbete med öppen PR: stannar
];
const WITH_OPEN_PR = new Set([11]);

/** Ett låtsas-`gh`: listar öppna issues, svarar på PR-sökningen, flyttar till #100, #101 … och minns anropen. */
function fakeGh(): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  let next = 100;
  const run: GhRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.includes("issues?state=open")) return JSON.stringify([open]);
    if (line.includes("search/issues")) {
      const n = Number(/Closes #(\d+)/.exec(line)?.[1]);
      return JSON.stringify({ total_count: WITH_OPEN_PR.has(n) ? 1 : 0 });
    }
    if (line.startsWith("issue transfer")) return `https://github.com/ulrik-s/ava-feedback/issues/${next++}\n`;
    return "{}";
  };
  return { run, calls };
}
const log = (lines: string[]) => (l: string): void => { lines.push(l); };

describe("inkorgen", () => {
  it("bara förfrågningar flyttas: inte arbetsorder, förslag, veckorapport, PR:er eller direkt arbete", () => {
    const items = gitHub("ulrik-s/ava", fakeGh().run).openItems();
    expect(strayIssues(items, NOW, (n) => WITH_OPEN_PR.has(n)).map((i) => i.number)).toEqual([5, 8]);
    // Okänd ålder räknas inte som en förfrågan.
    expect(strayIssues([{ number: 1, title: "t", body: "", labels: [], isPr: false }], NOW, () => false)).toEqual([]);
  });

  it("flaggorna som stannar finns i kodrepots flöde", () => {
    const flags = Object.keys(flow.machines["code-issue"]?.flags ?? {});
    for (const f of STAYS_IN_CODE_REPO) expect(flags).toContain(f);
  });

  it("med token: flyttar och märker intern + bugg eller förslag i inkorgen", () => {
    const source = fakeGh();
    const intake = fakeGh();
    const lines: string[] = [];
    const moved = moveStrayIssues(gitHub("ulrik-s/ava", source.run), {
      source: gitHub("ulrik-s/ava", source.run), intake: gitHub("ulrik-s/ava-feedback", intake.run), intakeRepo: "ulrik-s/ava-feedback",
    }, { now: NOW, enforce: true, log: log(lines) });
    expect(moved).toEqual([[5, 100], [8, 101]]);
    expect(source.calls.filter((c) => c.startsWith("issue transfer"))).toEqual([
      "issue transfer 5 ulrik-s/ava-feedback -R ulrik-s/ava",
      "issue transfer 8 ulrik-s/ava-feedback -R ulrik-s/ava",
    ]);
    expect(intake.calls).toEqual([
      "api repos/ulrik-s/ava-feedback/issues/100/labels -f labels[]=intern",
      "api repos/ulrik-s/ava-feedback/issues/100/labels -f labels[]=bugg",
      "api repos/ulrik-s/ava-feedback/issues/101/labels -f labels[]=intern",
      "api repos/ulrik-s/ava-feedback/issues/101/labels -f labels[]=förslag",
    ]);
    expect(lines).toEqual(["#5 → ulrik-s/ava-feedback#100 (intern)", "#8 → ulrik-s/ava-feedback#101 (intern)"]);
  });

  it("utan token eller i rapportläge flyttas inget, men det loggas", () => {
    const gh = fakeGh();
    const lines: string[] = [];
    expect(moveStrayIssues(gitHub("ulrik-s/ava", gh.run), null, { now: NOW, enforce: true, log: log(lines) })).toEqual([]);
    const mover = { source: gitHub("ulrik-s/ava", gh.run), intake: gitHub("ulrik-s/ava-feedback", gh.run), intakeRepo: "ulrik-s/ava-feedback" };
    expect(moveStrayIssues(gitHub("ulrik-s/ava", gh.run), mover, { now: NOW, enforce: false, log: log(lines) })).toEqual([]);
    expect(lines).toEqual([
      "förfrågningar i kodrepot: #5, #8 — ingen FLOW_TRANSFER_TOKEN, flyttas inte",
      "förfrågningar i kodrepot: #5, #8 — bara rapport",
    ]);
    expect(gh.calls.some((c) => c.startsWith("issue transfer"))).toBe(false);
  });

  it("en nekad flytt varnar och stoppar varken nästa flytt eller klockan", () => {
    const denied = "gh issue transfer 5 ulrik-s/ava-feedback -R ulrik-s/ava: GraphQL: Resource not accessible by personal access token (transferIssue)";
    const source = fakeGh();
    const intake = fakeGh();
    const deniesFive: GhRunner = (args) => {
      if (args.join(" ").startsWith("issue transfer 5 ")) throw new Error(denied);
      return source.run(args);
    };
    const lines: string[] = [];
    const moved = moveStrayIssues(gitHub("ulrik-s/ava", source.run), {
      source: gitHub("ulrik-s/ava", deniesFive), intake: gitHub("ulrik-s/ava-feedback", intake.run), intakeRepo: "ulrik-s/ava-feedback",
    }, { now: NOW, enforce: true, log: log(lines) });
    expect(moved).toEqual([[8, 100]]);
    expect(intake.calls).toEqual([
      "api repos/ulrik-s/ava-feedback/issues/100/labels -f labels[]=intern",
      "api repos/ulrik-s/ava-feedback/issues/100/labels -f labels[]=förslag",
    ]);
    expect(lines).toEqual([
      `::warning::flytten av #5 till ulrik-s/ava-feedback blev inte klar: ${denied}`,
      "#8 → ulrik-s/ava-feedback#100 (intern)",
    ]);
  });

  it("en flytt vars märkning nekas räknas inte som flyttad, och varningen säger vilket anrop som föll", () => {
    const source = fakeGh();
    const deniesLabels: GhRunner = (args) => { throw new Error(`gh ${args.join(" ")}: HTTP 403`); };
    const lines: string[] = [];
    const moved = moveStrayIssues(gitHub("ulrik-s/ava", source.run), {
      source: gitHub("ulrik-s/ava", source.run), intake: gitHub("ulrik-s/ava-feedback", deniesLabels), intakeRepo: "ulrik-s/ava-feedback",
    }, { now: NOW, enforce: true, log: log(lines) });
    expect(moved).toEqual([]);
    expect(lines).toEqual([
      "::warning::flytten av #5 till ulrik-s/ava-feedback blev inte klar: gh api repos/ulrik-s/ava-feedback/issues/100/labels -f labels[]=intern: HTTP 403",
      "::warning::flytten av #8 till ulrik-s/ava-feedback blev inte klar: gh api repos/ulrik-s/ava-feedback/issues/101/labels -f labels[]=intern: HTTP 403",
    ]);
  });

  it("inget att flytta: ingen loggrad", () => {
    const lines: string[] = [];
    const run: GhRunner = () => JSON.stringify([[issue(6, ["agent-task"])]]);
    expect(moveStrayIssues(gitHub("ulrik-s/ava", run), null, { now: NOW, enforce: true, log: log(lines) })).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("ett oväntat svar från gh issue transfer stoppar flytten", () => {
    const run: GhRunner = () => "något gick fel\n";
    expect(() => gitHub("ulrik-s/ava", run).transferIssue(5, "ulrik-s/ava-feedback")).toThrow(/oväntat svar/);
  });

  it("bara Ulrik (eller klockan med hans token) sätter intern, inte en agent", () => {
    const intake = flow.machines.intake;
    if (!intake) throw new Error("flow.yaml saknar intake");
    expect(decide(intake, { label: "intern", current: ["intern"], previous: null, byUlrik: false }).kind).toBe("reject");
    expect(decide(intake, { label: "intern", current: ["intern"], previous: null, byUlrik: true })).toEqual({ kind: "ignore" });
  });
});

/**
 * Delar av en intern förfrågan (#2073): loop 1 delar upp en förfrågan i
 * sub-issues, men en agent får inte sätta `intern`, så delen stod utan flagga
 * och loop 1 tog den aldrig. Klockan sätter `intern` när föräldern har den.
 */
describe("delar av en intern förfrågan", () => {
  const PARENT = (n: number) => `https://api.github.com/repos/ulrik-s/ava-feedback/issues/${n}`;
  const part = (number: number, labels: string[], parent: string | null) =>
    ({ number, title: "t", body: "", labels: labels.map((name) => ({ name })), parent_issue_url: parent });
  const rows = [
    part(133, ["bugg"], PARENT(89)), // del av en intern förfrågan: får intern
    part(135, ["bugg", "prio-hög"], PARENT(93)), // dito, förälder stängd (uppdelad)
    part(140, ["förslag", "user-request"], PARENT(120)), // del av en användares: rörs inte
    part(141, ["bugg", "intern"], PARENT(89)), // redan intern
    part(142, ["bugg"], PARENT(120)), // förälder utan intern: rörs inte
    part(143, ["bugg"], "https://api.github.com/repos/ulrik-s/ava/issues/9"), // förälder i ett annat repo
    part(144, ["bugg"], null), // ingen förälder
  ];
  const PARENT_LABELS: Record<string, string[]> = { 89: ["intern", "nedbruten"], 93: ["intern", "uppdelad"], 120: ["user-request"] };

  function fakeIntake(): { run: GhRunner; calls: string[] } {
    const calls: string[] = [];
    const run: GhRunner = (args) => {
      const line = args.join(" ");
      calls.push(line);
      if (line.includes("issues?state=open")) return JSON.stringify([rows]);
      const labels = /issues\/(\d+)\/labels$/.exec(line)?.[1];
      if (labels !== undefined) return JSON.stringify((PARENT_LABELS[labels] ?? []).map((name) => ({ name })));
      return "{}";
    };
    return { run, calls };
  }

  it("bara delar utan intern och user-request, med förälder i samma repo, prövas", () => {
    const items = gitHub("ulrik-s/ava-feedback", fakeIntake().run).openItems();
    expect(orphanedParts(items, "ulrik-s/ava-feedback").map((i) => [i.number, i.parent])).toEqual([[133, 89], [135, 93], [142, 120]]);
  });

  it("sätter intern och kommenterar när föräldern är intern, och läser varje förälder en gång", () => {
    const gh = fakeIntake();
    const lines: string[] = [];
    expect(markInternalParts(gitHub("ulrik-s/ava-feedback", gh.run), "ulrik-s/ava-feedback", { enforce: true, log: log(lines) })).toEqual([133, 135]);
    const writes = gh.calls.filter((c) => c.includes("-f "));
    expect(writes).toEqual([
      "api repos/ulrik-s/ava-feedback/issues/133/labels -f labels[]=intern",
      "api repos/ulrik-s/ava-feedback/issues/133/comments -f body=Flödesvakten: del av #89, som är intern. Etiketten `intern` är satt, så att loop 1 tar den.",
      "api repos/ulrik-s/ava-feedback/issues/135/labels -f labels[]=intern",
      "api repos/ulrik-s/ava-feedback/issues/135/comments -f body=Flödesvakten: del av #93, som är intern. Etiketten `intern` är satt, så att loop 1 tar den.",
    ]);
    expect(gh.calls.filter((c) => /issues\/(89|93|120)\/labels$/.test(c))).toHaveLength(3);
    expect(lines).toEqual(["#133: del av #89 (intern) — intern satt", "#135: del av #93 (intern) — intern satt"]);
  });

  it("i rapportläge sätts inget, men det loggas", () => {
    const gh = fakeIntake();
    const lines: string[] = [];
    expect(markInternalParts(gitHub("ulrik-s/ava-feedback", gh.run), "ulrik-s/ava-feedback", { enforce: false, log: log(lines) })).toEqual([133, 135]);
    expect(gh.calls.some((c) => c.includes("-f "))).toBe(false);
    expect(lines).toEqual(["#133: del av #89 (intern) — intern saknas (bara rapport)", "#135: del av #93 (intern) — intern saknas (bara rapport)"]);
  });

  it("en förälder som inte går att läsa varnar och stoppar inte de andra", () => {
    const gh = fakeIntake();
    const failing: GhRunner = (args) => {
      if (args.join(" ").endsWith("issues/89/labels")) throw new Error("gh api repos/ulrik-s/ava-feedback/issues/89/labels: HTTP 502");
      return gh.run(args);
    };
    const lines: string[] = [];
    expect(markInternalParts(gitHub("ulrik-s/ava-feedback", failing), "ulrik-s/ava-feedback", { enforce: true, log: log(lines) })).toEqual([135]);
    expect(lines[0]).toBe("::warning::#133: föräldern #89 gick inte att läsa: gh api repos/ulrik-s/ava-feedback/issues/89/labels: HTTP 502");
  });
});
