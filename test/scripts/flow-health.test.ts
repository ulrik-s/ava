/**
 * Hälsokontrollen (statussidan + push vid nya larm) och den automatiska
 * taggen i agentkedjans flöde.
 */
import { describe, expect, it } from "vitest-compat";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { healthReport, type HealthItem, newAlarms, previousAlarmKeys, renderStatus } from "../../tooling/scripts/flow/health";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { commitType, nextVersion, releaseDecision } from "../../tooling/scripts/flow/release";
import { collectItems, lastClockRun, publishStatus } from "../../tooling/scripts/flow-health";
import { runRelease } from "../../tooling/scripts/flow-release";

const flow = loadFlow();
const HOUR = 3_600_000;
const now = new Date("2026-11-20T12:00:00Z").getTime();
const ago = (h: number): string => new Date(now - h * HOUR).toISOString();

const item = (over: Partial<HealthItem>): HealthItem => ({
  repo: "ulrik-s/ava", number: 1, title: "En sak", labels: [], labeledAt: {}, isPr: false, ...over,
});

describe("hälsokontrollen", () => {
  it("larmar för flera tillstånd, fastnat, grön men omergad och en klocka som stått still", () => {
    const report = healthReport(flow, {
      now,
      lastClockRun: ago(5),
      items: [
        item({ number: 1, labels: ["att-granska", "granskad"], labeledAt: { "att-granska": ago(1), granskad: ago(1) } }),
        item({ number: 2, labels: ["agent-task", "att-granska"], labeledAt: { "att-granska": ago(7) } }),
        item({ number: 3, isPr: true, labels: ["agent-pr", "granskad"], labeledAt: { granskad: ago(2) }, mergeState: "clean" }),
      ],
    });
    expect(report.alarms.map((a) => a.key)).toEqual(["multi:ava#1", "stuck:ava#2", "unmerged:ava#3", "clock"]);
  });

  it("det som väntar på Ulrik larmar inte men listas; resten rör sig", () => {
    const report = healthReport(flow, {
      now,
      lastClockRun: ago(0.5),
      items: [
        item({ number: 4, labels: ["agent-pr", "behöver-ändras", "blockerad"], isPr: true, labeledAt: { "behöver-ändras": ago(30) } }),
        item({ repo: "ulrik-s/ava-feedback", number: 9, labels: ["user-request", "undersökt"], labeledAt: { undersökt: ago(30) } }),
        item({ number: 5, labels: ["agent-task", "pågår"], labeledAt: { pågår: ago(1) } }),
        item({ number: 6, labels: ["agent-task"] }),
      ],
    });
    expect(report.alarms).toEqual([]);
    expect(report.waitingForUlrik).toHaveLength(2);
    expect(report.moving).toEqual(["ava#5 En sak — pågår"]);
  });

  it("ingen klockkörning alls larmar", () => {
    expect(healthReport(flow, { now, lastClockRun: null, items: [] }).alarms.map((a) => a.key)).toEqual(["clock"]);
  });

  it("statussidan bär larmnycklarna; bara nya larm skickas som push", () => {
    const report = { alarms: [{ key: "a", text: "A" }, { key: "b", text: "B" }], waitingForUlrik: [], moving: [] };
    const body = renderStatus(report, now);
    expect(previousAlarmKeys(body)).toEqual(["a", "b"]);
    expect(newAlarms(report, body)).toEqual([]);
    expect(newAlarms(report, "<!-- larm: a -->").map((a) => a.key)).toEqual(["b"]);
    expect(previousAlarmKeys("")).toEqual([]);
    expect(renderStatus({ alarms: [], waitingForUlrik: [], moving: [] }, now)).toContain("Inga larm");
  });
});

/** Ett låtsas-`gh` som svarar ur en tabell (första träff) och minns anropen. */
function fakeGh(answers: Array<[string, unknown]>): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    const hit = answers.find(([k]) => line.includes(k));
    return JSON.stringify(hit === undefined ? {} : hit[1]);
  };
  return { run, calls };
}

const ghEvent = (id: number, label: string, at: string) =>
  ({ id, event: "labeled", created_at: at, label: { name: label }, actor: { login: "ulrik-s" }, performed_via_github_app: { slug: "claude" } });

describe("hälsokontrollen mot GitHub", () => {
  it("samlar saker med tillstånd eller blockerad, med tidpunkter och PR-läge", () => {
    const gh = fakeGh([
      ["issues?state=open", [[
        { number: 7, title: "PR", labels: [{ name: "agent-pr" }, { name: "granskad" }], pull_request: {} },
        { number: 8, title: "Annat", labels: [{ name: "tooling" }] },
      ]]],
      ["/events", [[ghEvent(1, "granskad", ago(2))]]],
      ["/pulls/7", { mergeable_state: "clean" }],
    ]);
    const items = collectItems(flow, (repo) => gitHub(repo, gh.run));
    const pr = items.find((i) => i.number === 7 && i.repo === "ulrik-s/ava");
    expect(pr).toMatchObject({ isPr: true, mergeState: "clean", labeledAt: { granskad: ago(2) } });
    expect(items.some((i) => i.number === 8)).toBe(false);
  });

  it("klockans senaste körning: den senaste av dispatch och schema", () => {
    const gh = fakeGh([
      ["event=workflow_dispatch", { workflow_runs: [{ created_at: ago(1), conclusion: "success", head_sha: "a" }] }],
      ["event=schedule", { workflow_runs: [] }],
    ]);
    expect(lastClockRun(gitHub("ulrik-s/ava", gh.run))).toBe(ago(1));
    expect(lastClockRun(gitHub("ulrik-s/ava", fakeGh([["runs", { workflow_runs: [] }]]).run))).toBeNull();
  });

  it("skapar statussidan första gången, uppdaterar den sedan och nämner Ulrik vid nya larm", () => {
    const report = { alarms: [{ key: "x", text: "X har fastnat" }], waitingForUlrik: [], moving: [] };
    const first = fakeGh([["issues?state=open", [[]]]]);
    expect(publishStatus(gitHub("ulrik-s/ava-feedback", first.run), report, now, "ulrik-s", () => {})).toBe(1);
    expect(first.calls.some((c) => c.includes("title=Agentkedjans status"))).toBe(true);

    const later = fakeGh([["issues?state=open", [[{ number: 50, title: "Agentkedjans status", body: "<!-- larm:  -->", labels: [{ name: "agentstatus" }] }]]]]);
    const lines: string[] = [];
    expect(publishStatus(gitHub("ulrik-s/ava-feedback", later.run), report, now, "ulrik-s", (l) => lines.push(l))).toBe(1);
    expect(later.calls.some((c) => c.includes("-X PATCH repos/ulrik-s/ava-feedback/issues/50"))).toBe(true);
    expect(later.calls.some((c) => c.includes("issues/50/comments") && c.includes("@ulrik-s"))).toBe(true);
    expect(lines.at(-1)).toContain("nya: 1");
  });
});

describe("den automatiska taggen", () => {
  const base = {
    now, lastTag: "v0.7.9", lastTagAt: ago(24), subjects: ["feat(time): x", "docs: y"],
    mainSha: "abc", ci: { sha: "abc", conclusion: "success" }, disabled: false,
  };

  it("tolkar commit-typer och räknar fram nästa version", () => {
    expect(commitType("feat(time): tid i timmar")).toBe("feat");
    expect(commitType("fix!: x")).toBe("fix");
    expect(commitType("Update settings.json")).toBeNull();
    expect(nextVersion("v0.7.9")).toBe("v0.7.10");
    expect(() => nextVersion("släpp-1")).toThrow();
  });

  it("taggar när perioden gått, det finns ändringar och CI är grön på exakt main", () => {
    expect(releaseDecision(flow, base)).toEqual({ release: true, tag: "v0.7.10" });
  });

  it("taggar inte: avstängd, för tätt, bara docs, eller CI inte grön", () => {
    expect(releaseDecision(flow, { ...base, disabled: true })).toMatchObject({ release: false, reason: expect.stringContaining("AUTO_RELEASE") });
    expect(releaseDecision(flow, { ...base, lastTagAt: ago(3) })).toMatchObject({ release: false, reason: expect.stringContaining("3 h") });
    expect(releaseDecision(flow, { ...base, subjects: ["docs: y", "chore: z"] })).toMatchObject({ release: false });
    expect(releaseDecision(flow, { ...base, ci: { sha: "old", conclusion: "success" } })).toMatchObject({ release: false });
    expect(releaseDecision(flow, { ...base, ci: null })).toMatchObject({ release: false });
    expect(releaseDecision(flow, { ...base, ci: { sha: "abc", conclusion: "failure" } })).toMatchObject({ release: false });
  });

  it("mot GitHub: skapar taggen och startar release.yml på den — bara i enforce", () => {
    const answers: Array<[string, unknown]> = [
      ["releases/latest", { tag_name: "v0.7.9", created_at: ago(24) }],
      ["commits/main", { sha: "abc" }],
      ["compare/v0.7.9...main", { commits: [{ commit: { message: "feat(x): y\n\nbody" } }] }],
      ["ci.yml/runs", { workflow_runs: [{ created_at: ago(1), conclusion: "success", head_sha: "abc" }] }],
    ];
    const live = fakeGh(answers);
    const lines: string[] = [];
    expect(runRelease(flow, gitHub("ulrik-s/ava", live.run), { now, disabled: false, enforce: true, log: (l) => lines.push(l) })).toEqual({ release: true, tag: "v0.7.10" });
    expect(live.calls.some((c) => c.includes("ref=refs/tags/v0.7.10") && c.includes("sha=abc"))).toBe(true);
    expect(live.calls.some((c) => c.includes("workflows/release.yml/dispatches") && c.includes("ref=v0.7.10"))).toBe(true);

    const dry = fakeGh(answers);
    runRelease(flow, gitHub("ulrik-s/ava", dry.run), { now, disabled: false, enforce: false, log: () => {} });
    expect(dry.calls.some((c) => c.includes("refs/tags"))).toBe(false);

    const off = fakeGh(answers);
    expect(runRelease(flow, gitHub("ulrik-s/ava", off.run), { now, disabled: true, enforce: true, log: (l) => lines.push(l) }).release).toBe(false);
    expect(lines.at(-1)).toContain("ingen tagg");
  });
});
