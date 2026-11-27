/**
 * Beroendenätet mellan arbetsorder (#1720): `Beror på #N` speglas som
 * GitHub-beroenden, prioriteten ärvs nedåt, vakten väntar på blockerare och
 * startar loop 4 när den sista stängs, knuffen och statussidan ser blockerade.
 */
import { describe, expect, it } from "vitest-compat";
import { type Edge, dependsOn, effectivePrio, isCycleError, missingEdges, ownPrio, prioChange } from "../../tooling/scripts/flow/dependencies";
import { type FetchFn, waitsForBlockers } from "../../tooling/scripts/flow/dispatch";
import { ghFailure, gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { healthReport, type HealthItem, prioOrder } from "../../tooling/scripts/flow/health";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { dueNudges } from "../../tooling/scripts/flow/watchdog";
import { mirror, openBlockers, runDependencies } from "../../tooling/scripts/flow-deps";
import { dispatchLabel, dispatchUnblocked } from "../../tooling/scripts/flow-guard";
import { collectItems } from "../../tooling/scripts/flow-health";
import { watchItems } from "../../tooling/scripts/flow-watchdog";

const flow = loadFlow();
const codeIssue = flow.machines["code-issue"];
if (!codeIssue) throw new Error("saknar code-issue");
const ORDER = prioOrder(flow);
const AVA = "ulrik-s/ava";
const quiet = (): void => {};

/** Ett låtsas-`gh`: svar ur en tabell (första träff på delsträng; en funktion kan kasta), och anropen. */
function fakeGh(answers: Array<[string, unknown]>): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    const hit = answers.find(([k]) => line.includes(k))?.[1];
    return JSON.stringify(typeof hit === "function" ? hit() : hit ?? {});
  };
  return { run, calls };
}

const row = (number: number, body: string, labels: string[] = [], blockedBy = 0, blocking = 0) =>
  ({ id: 9000 + number, number, title: `t${number}`, body, labels: labels.map((name) => ({ name })), issue_dependencies_summary: { blocked_by: blockedBy, blocking } });
const dep = (number: number, labels: string[] = [], state = "open", repo = AVA) =>
  ({ id: 9000 + number, number, state, repository_url: `https://api.github.com/repos/${repo}`, labels: labels.map((name) => ({ name })) });
const cycle = (): never => { throw new Error("gh api: Validation failed: this dependency would create a cycle where the target is already blocked by the source (HTTP 422)"); };

describe("beroendenätet: regler", () => {
  it("läser Beror på-raderna, utan dubbletter och utan beroenden i andra repon", () => {
    expect(dependsOn("Beror på #10\nBeror på #12\nBeror på #10\nBeror på ava-feedback#7")).toEqual([10, 12]);
    expect(dependsOn("Inga beroenden")).toEqual([]);
  });

  it("saknade kanter: bara öppna blockerare, inte sig själv, inte de som redan finns", () => {
    const ids = new Map([[10, 9010], [11, 9011], [12, 9012]]);
    const existing: Edge[] = [{ blocker: 12, blocked: 11 }];
    expect(missingEdges({ number: 11, body: "Beror på #10\nBeror på #11\nBeror på #12\nBeror på #9" }, existing, ids))
      .toEqual([{ blocker: 10, blocked: 11, blockerId: 9010 }]);
  });

  it("egen prioritet ur raden Prioritet:", () => {
    expect(ownPrio("…\nPrioritet: hög\nIntag: ava-feedback#3", ORDER)).toBe("prio-hög");
    expect(ownPrio("Prioritet: bråttom", ORDER)).toBeNull();
    expect(ownPrio("ingen rad", ORDER)).toBeNull();
  });

  it("prioriteten ärvs nedåt genom kedjan, högsta vinner, egen högre står kvar", () => {
    // 3 väntar på 2 som väntar på 1; 4 väntar också på 1. 5 är hög själv och väntas på av en låg.
    const edges: Edge[] = [{ blocker: 2, blocked: 3 }, { blocker: 1, blocked: 2 }, { blocker: 1, blocked: 4 }, { blocker: 5, blocked: 6 }];
    const own = new Map([[1, "prio-låg"], [3, "prio-hög"], [4, "prio-medel"], [5, "prio-hög"], [6, "prio-låg"]]);
    const eff = effectivePrio(own, edges, ORDER);
    expect([eff.get(1), eff.get(2), eff.get(3), eff.get(4), eff.get(5)]).toEqual(["prio-hög", "prio-hög", "prio-hög", "prio-medel", "prio-hög"]);
  });

  it("en cirkel får inte slingan att hänga", () => {
    const eff = effectivePrio(new Map([[1, "prio-medel"]]), [{ blocker: 1, blocked: 2 }, { blocker: 2, blocked: 1 }], ORDER);
    expect([eff.get(1), eff.get(2)]).toEqual(["prio-medel", "prio-medel"]);
  });

  it("etikettändringen byter prioritet och rör inget annat", () => {
    expect(prioChange(["granskad", "prio-låg"], "prio-hög", ORDER)).toEqual({ add: "prio-hög", remove: ["prio-låg"] });
    expect(prioChange(["prio-hög"], "prio-hög", ORDER)).toEqual({ add: null, remove: [] });
  });

  it("känner igen GitHubs vägran att skapa en cirkel", () => {
    expect(isCycleError(new Error("… would create a cycle …"))).toBe(true);
    expect(isCycleError(new Error("HTTP 500"))).toBe(false);
    expect(isCycleError("would create a cycle")).toBe(false);
  });

  it("granskad väntar på blockerare, att-granska och okända etiketter gör det inte", () => {
    expect(waitsForBlockers(codeIssue, "granskad")).toBe(true);
    expect(waitsForBlockers(codeIssue, "att-granska")).toBe(false);
    expect(waitsForBlockers(codeIssue, "okänd")).toBe(false);
  });
});

describe("beroendenätet mot GitHub", () => {
  const open = [
    row(10, "Grund\nPrioritet: låg", [], 0, 1),
    row(11, "Beror på #10\nPrioritet: hög", ["prio-medel"]),
    row(12, "Beror på #9\nPrioritet: medel", ["prio-medel"]),
    row(13, "Beror på #10", [], 1),
  ];
  const answers = (): Array<[string, unknown]> => [
    ["issues?state=open", [open]],
    ["issues/13/dependencies/blocked_by?per_page", [dep(10)]],
    ["-X POST", { number: 11 }],
  ];

  it("läser id och beroenden ur issuelistan, och blockerare bara öppna i samma repo", () => {
    const gh = gitHub(AVA, fakeGh([["issues?state=open", [[row(10, "", [], 2, 1)]]], ["blocked_by", [dep(1), dep(2, [], "closed"), dep(3, [], "open", "ulrik-s/annat")]]]).run);
    expect(gh.openItems()[0]).toMatchObject({ id: 9010, deps: { blockedBy: 2, blocking: 1 } });
    expect(gh.blockers(10)).toEqual([{ number: 1, id: 9001, labels: [] }]);
  });

  it("speglar Beror på som GitHub-beroenden och sätter ärvd prioritet", () => {
    const gh = fakeGh(answers());
    const lines: string[] = [];
    const r = runDependencies(gitHub(AVA, gh.run), ORDER, { enforce: true, log: (l) => lines.push(l) });
    expect(r.added).toEqual([{ blocker: 10, blocked: 11, blockerId: 9010 }]);
    expect(gh.calls).toContain(`api -X POST repos/${AVA}/issues/11/dependencies/blocked_by -F issue_id=9010`);
    expect(r.prio).toEqual([{ number: 10, prio: "prio-hög" }, { number: 11, prio: "prio-hög" }]);
    expect(gh.calls).toContain(`api repos/${AVA}/issues/10/labels -f labels[]=prio-hög`);
    expect(gh.calls).toContain(`api -X DELETE repos/${AVA}/issues/11/labels/prio-medel`);
    expect(lines).toContain("#10: prio-hög (ärvd)");
  });

  it("i rapportläge ändras inget, men det som skulle göras räknas", () => {
    const gh = fakeGh(answers());
    const r = runDependencies(gitHub(AVA, gh.run), ORDER, { enforce: false, log: quiet });
    expect(r.added).toHaveLength(1);
    expect(r.prio).toHaveLength(2);
    expect(gh.calls.filter((c) => c.includes("-X") || c.includes("labels -f"))).toEqual([]);
  });

  it("en cirkel blockerar issuen med en förklaring, en gång", () => {
    const gh = fakeGh([["-X POST", cycle]]);
    const ids = new Map([[10, 9010]]);
    const added = mirror(gitHub(AVA, gh.run), { number: 11, title: "", body: "Beror på #10", labels: [], isPr: false }, [], ids, { enforce: true, log: quiet });
    expect(added).toEqual([]);
    expect(gh.calls).toContain(`api repos/${AVA}/issues/11/labels -f labels[]=blockerad`);
    expect(gh.calls.some((c) => c.includes("issues/11/comments") && c.includes("cirkulärt beroende"))).toBe(true);

    const again = fakeGh([["-X POST", cycle]]);
    mirror(gitHub(AVA, again.run), { number: 11, title: "", body: "Beror på #10", labels: ["blockerad"], isPr: false }, [], ids, { enforce: true, log: quiet });
    expect(again.calls.filter((c) => c.includes("labels") || c.includes("comments"))).toEqual([]);
  });

  it("andra fel från GitHub släpps igenom", () => {
    const gh = fakeGh([["-X POST", (): never => { throw new Error("HTTP 500"); }]]);
    expect(() => mirror(gitHub(AVA, gh.run), { number: 11, title: "", body: "Beror på #10", labels: [], isPr: false }, [], new Map([[10, 1]]), { enforce: true, log: quiet })).toThrow("HTTP 500");
  });

  it("vaktens fråga: befintliga blockerare plus nyss speglade", () => {
    const gh = fakeGh([["issues?state=open", [open]], ["issues/11/dependencies/blocked_by?per_page", [dep(7)]], ["-X POST", {}]]);
    expect(openBlockers(gitHub(AVA, gh.run), 11, { enforce: true, log: quiet })).toEqual([7, 10]);
  });
});

describe("vakten väntar på blockerare", () => {
  const okFetch = (urls: string[]): FetchFn => (url) => { urls.push(url); return Promise.resolve({ ok: true, status: 200 }); };
  const payload = (label: string) => ({ label: { name: label }, repository: { full_name: AVA }, issue: { number: 11, labels: [{ name: label }] } });
  const env = { ROUTINE_TOKEN_L4: "t", ROUTINE_TOKEN_L3: "t" };

  it("startar inte loop 4 på en blockerad arbetsorder, men gör det när inget blockerar", async () => {
    const urls: string[] = [];
    const lines: string[] = [];
    expect(await dispatchLabel(flow, payload("granskad"), env, { fetch: okFetch(urls), log: (l) => lines.push(l), openBlockers: () => [10] })).toBe(false);
    expect(urls).toEqual([]);
    expect(lines).toContain("#11: väntar på #10 — L4 startas när de är klara");
    expect(await dispatchLabel(flow, payload("granskad"), env, { fetch: okFetch(urls), log: quiet, openBlockers: () => [] })).toBe(true);
  });

  it("granskningen (att-granska) väntar inte: blockerarna frågas inte ens", async () => {
    const asked: number[] = [];
    expect(await dispatchLabel(flow, payload("att-granska"), env, { fetch: okFetch([]), log: quiet, openBlockers: (n) => { asked.push(n); return [10]; } })).toBe(true);
    expect(asked).toEqual([]);
  });

  it("när sista blockeraren stängs startas loop 4, en gång", async () => {
    const gh = fakeGh([
      ["issues/10/dependencies/blocking", [dep(11, ["granskad"]), dep(12, ["granskad"]), dep(13, ["granskad"]), dep(14, ["att-granska"])]],
      ["issues/13/dependencies/blocked_by", [dep(15)]],
      ["dependencies/blocked_by", []],
    ]);
    const urls: string[] = [];
    const closed = { action: "closed" as const, repository: { full_name: AVA }, issue: { number: 10 } };
    expect(await dispatchUnblocked(flow, closed, gitHub(AVA, gh.run), env, { fetch: okFetch(urls), log: quiet })).toBe(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`${flow.routines.L4?.trigger_id ?? "?"}/fire`);
  });

  it("stängd issue i ett okänt repo: inget", async () => {
    const closed = { action: "closed" as const, repository: { full_name: "ulrik-s/annat" }, issue: { number: 10 } };
    expect(await dispatchUnblocked(flow, closed, gitHub("ulrik-s/annat", fakeGh([]).run), env, { fetch: okFetch([]), log: quiet })).toBe(0);
  });
});

describe("klockan och statussidan ser blockerade", () => {
  const HOUR = 3_600_000;
  const now = new Date("2026-11-20T12:00:00Z").getTime();
  const ago = (h: number): string => new Date(now - h * HOUR - 60_000).toISOString();

  it("knuffen hoppar över en blockerad sak", () => {
    const item = { number: 11, labels: ["granskad"], labeledAt: { granskad: ago(2) }, hasOpenPr: false };
    expect(dueNudges(codeIssue, flow.nudge, [item], now)).toHaveLength(1);
    expect(dueNudges(codeIssue, flow.nudge, [{ ...item, blocked: true }], now)).toEqual([]);
  });

  it("klockans lista märker blockerade ur issuelistan", () => {
    const gh = gitHub(AVA, fakeGh([["issues?state=open", [[row(11, "", ["granskad"], 1), row(12, "", ["granskad"])]]], ["events", [[]]]]).run);
    expect(watchItems(codeIssue, gh).map((i) => i.blocked ?? false)).toEqual([true, false]);
  });

  it("statussidan: blockerad larmar inte som fastnad, en grund säger hur många som väntar", () => {
    const base: HealthItem = { repo: AVA, number: 11, title: "Funktion", labels: ["att-granska"], labeledAt: { "att-granska": ago(10) }, isPr: false };
    const report = healthReport(flow, { now, lastClockRun: ago(0), items: [
      { ...base, blockedBy: 2 },
      { ...base, number: 10, title: "Grund", blocking: 3 },
    ] });
    expect(report.alarms.map((a) => a.text)).toEqual(["ava#10 Grund — har stått i att-granska i 10 h trots knuffar (3 väntar på den)"]);
    expect(report.moving).toContain("ava#11 Funktion — att-granska — väntar på 2 beroende(n)");
  });

  it("hälsokontrollen tar med beroendena från issuelistan", () => {
    const gh = fakeGh([["ulrik-s/ava/issues?state=open", [[row(11, "", ["granskad"], 1, 2)]]], ["pulls?state=open", [[]]], ["issues?state=open", [[]]], ["events", [[]]]]);
    const items = collectItems(flow, (repo) => gitHub(repo, gh.run));
    expect(items.find((i) => i.number === 11)).toMatchObject({ blockedBy: 1, blocking: 2 });
  });
});

describe("felet från gh (#1774)", () => {
  it("ghs egen text, annars processfelet, annars hur den avslutades", () => {
    expect(ghFailure({ status: 1, signal: null, stderr: "HTTP 404\n" })).toBe("HTTP 404");
    expect(ghFailure({ status: null, signal: "SIGTERM", stderr: "", error: new Error("spawnSync gh ENOBUFS") })).toBe("spawnSync gh ENOBUFS");
    expect(ghFailure({ status: null, signal: "SIGTERM", stderr: "" })).toBe("avslutades med SIGTERM");
    expect(ghFailure({ status: 2, signal: null, stderr: "  " })).toBe("avslutades med 2");
  });
});
