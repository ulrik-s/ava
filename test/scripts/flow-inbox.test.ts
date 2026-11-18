/**
 * Inkorgen för allt arbete: en issue i kodrepot utan arbetsorder-flagga är en
 * förfrågan i fel repo och flyttas till ava-feedback som `intern`. Arbetsorder
 * (L2), förslag och veckorapport (L5), PR:er och direkt arbete (nytt, eller med
 * en öppen PR) stannar.
 */
import { describe, expect, it } from "vitest-compat";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { GRACE_MS, moveStrayIssues, STAYS_IN_CODE_REPO, strayIssues } from "../../tooling/scripts/flow/inbox";
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
