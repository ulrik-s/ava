/**
 * Agentkedjans flöde (tooling/agents/flow.yaml): filen hänger ihop, de
 * genererade filerna är aktuella, flödesvakten släpper bara tillåtna
 * övergångar och klockan verkställer timeouterna.
 */
import { describe, expect, it } from "vitest-compat";
import { feedbackState, INTAKE_LABELS } from "@/lib/shared/feedback";
import { AGENT_PR_PER_DAY } from "../../tooling/scripts/agent-guard";
import { dispatchTarget, earlierFire, type FetchFn, FIRE_WINDOW_MS } from "../../tooling/scripts/flow/dispatch";
import { renderMermaid } from "../../tooling/scripts/flow/generate";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { flowErrors, labelIn, loadFlow, machineNamed, parseFlow } from "../../tooling/scripts/flow/load";
import type { Flow, Machine } from "../../tooling/scripts/flow/schema";
import { decide, GUARD_ACTOR, type LabelEvent, normalizeRemovals, previousStateLabel } from "../../tooling/scripts/flow/transition";
import { closesIssue, dueNudges, dueTimeouts, duplicatePulls, hungRuns, parseDuration } from "../../tooling/scripts/flow/watchdog";
import { expectedFiles, staleFiles } from "../../tooling/scripts/flow-gen";
import { dispatchLabel, handleLabel, machineFor, normalize } from "../../tooling/scripts/flow-guard";
import { AGENT_PR, cancelHung, closeDuplicatePulls, rerunReleasedFromCap, runNudges, runTimeouts } from "../../tooling/scripts/flow-watchdog";

const flow: Flow = loadFlow();
const machine = (name: string): Machine => {
  const m = flow.machines[name];
  if (!m) throw new Error(`saknar maskinen ${name}`);
  return m;
};
const intake = machine("intake");
const codeIssue = machine("code-issue");
const codePr = machine("code-pr");

const ev = (id: number, label: string, added = true, viaApp = true): LabelEvent =>
  ({ id, label, added, actor: "ulrik-s", viaApp });

describe("flow.yaml", () => {
  it("hänger ihop", () => {
    expect(flowErrors(flow)).toEqual([]);
  });

  it("alla loopar kör en i taget (#1837: tre L4 samtidigt drog för mycket användning)", () => {
    expect(Object.entries(flow.routines).filter(([, r]) => r.parallel > 1)).toEqual([]);
  });

  it("labels.json och docs/agent-flow.md är genererade ur den aktuella filen", () => {
    expect(staleFiles(expectedFiles())).toEqual([]);
  });

  it("AVA:s statusetiketter (feedback.ts) finns alla i intagets flöde", () => {
    const known = new Set([...Object.values(intake.states).map((s) => s.label), ...Object.keys(intake.flags)]);
    expect(Object.values(INTAKE_LABELS).filter((l) => !known.has(l))).toEqual([]);
  });

  it("varje tillstånd och statusflagga i intagets flöde har en status i appen (#1995)", () => {
    // Flaggor som inte är någon status för användaren: förfrågan är fortfarande "mottagen".
    const statusless = ["blockerad", "agentstatus", "intern", "user-request", "bugg", "förslag", "auto-godkänn"];
    const statuslessPrefixes = ["prio-", "rek-"];
    const isStatusless = (l: string): boolean =>
      statusless.includes(l) || statuslessPrefixes.some((p) => l.startsWith(p));
    const states = Object.values(intake.states).flatMap((s) => (s.label === null ? [] : [s.label]));
    const flags = Object.keys(intake.flags).filter((l) => !isStatusless(l));
    expect([...states, ...flags].filter((l) => feedbackState(true, [l]) === "mottagen")).toEqual([]);
  });

  it("hittar trasiga övergångar, dubbla etiketter, onåbara tillstånd och okända agenter", () => {
    const broken = parseFlow(`
version: 1
ulrik: u
ci: { hang_minutes: 5 }
nudge: { after: 2h }
health: { stuck_after: 6h }
inbox: { grace: 2h }
release: { every: 6h, types: [feat] }
routines: {}
machines:
  m:
    repo: a/b
    items: issues
    description: d
    start: saknas
    states:
      a:
        label: x
        description: d
        agent: L9
        transitions: [{ to: b }]
        refuse: { to: [z], comment: k }
        timeout: { after: 1h, to: c, comment: k }
      lost:
        label: x
        description: d
        agent: null
    flags:
      f: { color: "000000", description: d }
  n:
    repo: a/b
    items: pulls
    description: d
    start: s
    states:
      s: { label: f, color: "111111", description: annan, agent: null }
`);
    const errors = flowErrors(broken).join("\n");
    for (const part of ["starttillståndet saknas", "övergången till b", "refuse nekar z", "timeouten går till c", "används två gånger", "saknar färg", "går inte att nå", "agenten L9", "olika färg"]) {
      expect(errors).toContain(part);
    }
  });

  it("vägrar etikettbeskrivningar som GitHub inte tar emot (> 100 tecken)", () => {
    const broken = structuredClone(loadFlow());
    const intake = broken.machines.intake;
    if (!intake) throw new Error("flow.yaml saknar intake");
    const state = Object.values(intake.states).find((st) => st.label !== null);
    if (!state?.label) throw new Error("intake saknar tillstånd med etikett");
    const label = state.label;
    state.description = "x".repeat(101);
    expect(flowErrors(broken).join("\n")).toContain(`etiketten ${label} har en beskrivning på 101 tecken`);
  });

  it("inkorgens graceperiod står i flödet (inbox.grace)", () => {
    expect(flow.inbox.grace).toBe("2h");
  });

  it("labelIn ger ett tillstånds eller en flaggas etikett och kastar för en okänd", () => {
    const pr = machineNamed(flow, "code-pr");
    expect(labelIn(pr, "granskad")).toBe("granskad");
    expect(labelIn(pr, "blockerad")).toBe("blockerad");
    expect(() => labelIn(pr, "finns-inte")).toThrow("flow.yaml saknar etiketten finns-inte");
  });

  it("machineNamed kastar för en okänd maskin", () => {
    expect(() => machineNamed(flow, "finns-inte")).toThrow("flow.yaml saknar maskinen finns-inte");
  });

  it("kastar när filen inte hänger ihop", () => {
    expect(() => loadFlow("test/scripts/fixtures/does-not-exist.yaml")).toThrow();
  });
});

describe("generatorn", () => {
  it("ritar start, övergångar, Ulrik-övergångar, timeouter och slut", () => {
    const text = renderMermaid(intake);
    expect(text).toContain("[*] --> mottagen");
    expect(text).toContain("undersokt --> verifierad : Ulrik");
    expect(text).toContain("levererad --> [*]");
    expect(renderMermaid(codeIssue)).toContain("pagar --> granskad : timeout 4 h");
    expect(renderMermaid(codeIssue)).toContain("att-granska --> granskad : Ulrik om refaktorisering");
  });

  it("listar filer som inte stämmer", () => {
    expect(staleFiles([["test/scripts/fixtures/does-not-exist.txt", "x"]])).toEqual(["test/scripts/fixtures/does-not-exist.txt"]);
  });
});

describe("övergångar", () => {
  const change = (label: string, current: string[], previous: string | null, byUlrik = false) =>
    decide(intake, { label, current, previous, byUlrik });

  it("en tillåten övergång tar bort det gamla tillståndet", () => {
    expect(change("undersökt", ["user-request", "undersökt"], null)).toEqual({ kind: "allow", remove: [] });
    expect(change("levererad", ["nedbruten", "levererad"], "nedbruten")).toEqual({ kind: "allow", remove: ["nedbruten"] });
  });

  it("en agent får inte sätta verifierad; den tas bort och det gamla läggs tillbaka", () => {
    expect(change("verifierad", ["verifierad"], "undersökt")).toEqual({ kind: "reject", reason: "Bara Ulrik själv får flytta undersokt → verifierad.", restore: "undersökt" });
  });

  it("Ulrik själv får göra alla övergångar", () => {
    expect(change("verifierad", ["undersökt", "verifierad"], "undersökt", true)).toEqual({ kind: "allow", remove: ["undersökt"] });
  });

  it("refuse nekar även Ulrik: verifierad på nedbruten eller levererad", () => {
    const d = change("verifierad", ["nedbruten", "verifierad"], "nedbruten", true);
    expect(d.kind).toBe("reject");
    expect(d.kind === "reject" && d.reason).toContain("redan nedbruten");
    expect(d.kind === "reject" && d.restore).toBeNull();
    // Har nedbruten redan tagits bort läggs den tillbaka.
    expect(change("verifierad", ["verifierad"], "nedbruten", true)).toMatchObject({ kind: "reject", restore: "nedbruten" });
    expect(change("verifierad", ["levererad", "verifierad"], "levererad", true)).toMatchObject({ kind: "reject", restore: null });
    expect(change("verifierad", ["nedbruten", "verifierad"], "nedbruten")).toMatchObject({ kind: "reject" });
  });

  it("en övergång som inte finns stoppas", () => {
    const d = change("levererad", ["undersökt", "levererad"], "undersökt");
    expect(d).toEqual({ kind: "reject", reason: "Övergången undersokt → levererad finns inte i flödet.", restore: null });
  });

  it("samma tillstånd igen är tillåtet", () => {
    expect(change("undersökt", ["undersökt"], "undersökt")).toEqual({ kind: "allow", remove: [] });
  });

  it("en okänd tidigare etikett räknas som start", () => {
    expect(change("undersökt", ["undersökt"], "något-annat")).toEqual({ kind: "allow", remove: [] });
  });

  it("refaktorisering kräver Ulrik för granskad", () => {
    const d = decide(codeIssue, { label: "granskad", current: ["refaktorisering", "granskad"], previous: "att-granska", byUlrik: false });
    expect(d.kind).toBe("reject");
    expect(decide(codeIssue, { label: "granskad", current: ["granskad"], previous: "att-granska", byUlrik: false })).toEqual({ kind: "allow", remove: [] });
  });

  it("flaggor: människa-godkänd bara av Ulrik, övriga fritt", () => {
    expect(decide(codePr, { label: "människa-godkänd", current: [], previous: null, byUlrik: false }).kind).toBe("reject");
    expect(decide(codePr, { label: "människa-godkänd", current: [], previous: null, byUlrik: true })).toEqual({ kind: "ignore" });
    expect(decide(codePr, { label: "agent-pr", current: [], previous: null, byUlrik: false })).toEqual({ kind: "ignore" });
  });

  it("föregående tillstånd är det senast satta, även om det tagits bort sedan", () => {
    const events = [ev(1, "att-granska"), ev(2, "granskad"), ev(3, "att-granska", false), ev(4, "pågår"), ev(5, "agent-task")];
    expect(previousStateLabel(events, 4, codeIssue)).toBe("granskad");
    expect(previousStateLabel(events, 2, codeIssue)).toBe("att-granska");
    // Borttaget före nästa: räknas fortfarande som föregående (agenterna tar bort det gamla först).
    expect(previousStateLabel([ev(1, "att-granska"), ev(2, "att-granska", false)], 3, codeIssue)).toBe("att-granska");
    expect(previousStateLabel([], 3, codeIssue)).toBeNull();
    expect(previousStateLabel([ev(1, "undersökt"), ev(2, "verifierad")], 3, intake)).toBe("verifierad");
  });

  it("en etikett som vakten själv nekade räknas inte som föregående tillstånd (ava-feedback#132)", () => {
    const at = (min: number): string => new Date(Date.parse("2026-11-21T00:00:00Z") + min * 60_000).toISOString();
    const timed = (id: number, label: string, min: number, added = true, actor = "ulrik-s"): LabelEvent =>
      ({ id, label, added, actor, viaApp: actor === "ulrik-s", at: at(min) });
    // Som på #105: design-godkänd → design-granskas nekas, sedan sätts nedbruten.
    const events = [
      timed(1, "design-granskas", 0), timed(2, "design-godkänd", 2), timed(3, "design-granskas", 3, false, GUARD_ACTOR),
      timed(4, "design-granskas", 5), timed(5, "design-granskas", 5.3, false, GUARD_ACTOR),
    ];
    expect(previousStateLabel(events, 6, intake)).toBe("design-godkänd");
    // Klockans timeout (borttagen av vakten timmar senare) räknas som ett tillstånd som gällt.
    expect(previousStateLabel([timed(1, "pågår", 0), timed(2, "pågår", 4 * 60, false, GUARD_ACTOR)], 3, codeIssue)).toBe("pågår");
    // Utan tid: som förut.
    expect(previousStateLabel([ev(1, "pågår"), { ...ev(2, "pågår", false), actor: GUARD_ACTOR }], 3, codeIssue)).toBe("pågår");
  });

  it("städning behåller tillståndet som kommit längst", () => {
    expect(normalizeRemovals(intake, ["undersökt", "verifierad", "nedbruten", "bugg"])).toEqual(["undersökt", "verifierad"]);
    expect(normalizeRemovals(intake, ["levererad"])).toEqual([]);
  });
});

describe("klockan", () => {
  const now = new Date("2026-11-20T12:00:00Z").getTime();
  const item = (labels: string[], at: string, hasOpenPr = false) =>
    ({ number: 7, labels, labeledAt: Object.fromEntries(labels.map((l) => [l, at])), hasOpenPr });

  it("tolkar timmar och dagar", () => {
    expect(parseDuration("4h")).toBe(4 * 3_600_000);
    expect(parseDuration("7d")).toBe(7 * 24 * 3_600_000);
  });

  it("en flagga som löpt ut tas bort", () => {
    const due = dueTimeouts(intake, [item(["väntar-på-användaren"], "2026-11-10T12:00:00Z")], now);
    expect(due).toEqual([{ number: 7, remove: "väntar-på-användaren", add: null, comment: expect.stringContaining("7 dagar") }]);
    expect(dueTimeouts(intake, [item(["väntar-på-användaren"], "2026-11-19T12:00:00Z")], now)).toEqual([]);
  });

  it("pågår utan öppen PR går tillbaka till granskad, med öppen PR står den kvar", () => {
    expect(dueTimeouts(codeIssue, [item(["pågår"], "2026-11-20T06:00:00Z")], now)).toEqual([{ number: 7, remove: "pågår", add: "granskad", comment: expect.stringContaining("4 timmar") }]);
    expect(dueTimeouts(codeIssue, [item(["pågår"], "2026-11-20T06:00:00Z", true)], now)).toEqual([]);
    expect(dueTimeouts(codeIssue, [{ number: 7, labels: ["pågår"], labeledAt: {}, hasOpenPr: false }], now)).toEqual([]);
  });

  it("hittar CI som hänger", () => {
    const runs = [
      { id: 1, status: "in_progress", startedAt: "2026-11-20T10:00:00Z" },
      { id: 2, status: "queued", startedAt: "2026-11-20T11:30:00Z" },
      { id: 3, status: "completed", startedAt: "2026-11-20T09:00:00Z" },
    ];
    expect(hungRuns(runs, now, 60)).toEqual([1]);
  });
});

/** Ett låtsas-`gh` som svarar ur en tabell och minns vad som anropades. */
function fakeGh(answers: Record<string, unknown>): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    const key = Object.keys(answers).find((k) => line.includes(k));
    const answer = key === undefined ? {} : answers[key];
    // En jobblogg är text, inte JSON (#2158): en sträng skickas vidare som den är.
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  };
  return { run, calls };
}

const ghEvent = (id: number, label: string, app: boolean, event = "labeled") =>
  ({ id, event, created_at: `2026-11-20T0${id}:00:00Z`, label: { name: label }, actor: { login: "ulrik-s" }, performed_via_github_app: app ? { slug: "claude" } : null });

describe("flödesvakten mot GitHub", () => {
  const payload = (label: string, labels: string[], pr = false) => ({
    label: { name: label },
    repository: { full_name: pr ? "ulrik-s/ava" : "ulrik-s/ava-feedback" },
    ...(pr ? { pull_request: { number: 9, labels: labels.map((name) => ({ name })) } } : { issue: { number: 9, labels: labels.map((name) => ({ name })) } }),
  });

  it("hittar maskinen för repo och sort", () => {
    expect(machineFor(flow, "ulrik-s/ava", "pulls")).toBe(codePr);
    expect(machineFor(flow, "x/y", "issues")).toBeNull();
  });

  it("stoppar en agent som sätter verifierad och lägger tillbaka undersökt", () => {
    const gh = fakeGh({ "/events": [[ghEvent(1, "undersökt", true), ghEvent(2, "undersökt", true, "unlabeled"), ghEvent(3, "undersökt", true), ghEvent(4, "verifierad", true)]] });
    const lines: string[] = [];
    const d = handleLabel(flow, payload("verifierad", ["verifierad"]), gitHub("ulrik-s/ava-feedback", gh.run), true, (l) => lines.push(l));
    expect(d.kind).toBe("reject");
    expect(gh.calls.some((c) => c.includes("-X DELETE repos/ulrik-s/ava-feedback/issues/9/labels/verifierad"))).toBe(true);
    expect(gh.calls.some((c) => c.includes("labels[]=undersökt"))).toBe(true);
    expect(gh.calls.some((c) => c.includes("/comments"))).toBe(true);
    expect(lines[0]).toContain("#9 verifierad");
  });

  it("Ulrik själv får verifiera; det gamla tillståndet tas bort", () => {
    const gh = fakeGh({ "/events": [[ghEvent(1, "undersökt", true), ghEvent(2, "verifierad", false)]] });
    const d = handleLabel(flow, payload("verifierad", ["undersökt", "verifierad"]), gitHub("ulrik-s/ava-feedback", gh.run), true, () => {});
    expect(d).toEqual({ kind: "allow", remove: ["undersökt"] });
    expect(gh.calls.some((c) => c.includes("labels/und%C3%A4rs") || c.includes("labels/unders%C3%B6kt"))).toBe(true);
  });

  it("Ulrik får inte verifiera en nedbruten förfrågan; nedbruten står kvar och vakten förklarar", () => {
    const gh = fakeGh({ "/events": [[ghEvent(1, "nedbruten", true), ghEvent(2, "verifierad", false)]] });
    const d = handleLabel(flow, payload("verifierad", ["nedbruten", "verifierad"]), gitHub("ulrik-s/ava-feedback", gh.run), true, () => {});
    expect(d.kind).toBe("reject");
    expect(gh.calls.some((c) => c.includes("issues/9/labels/verifierad"))).toBe(true);
    expect(gh.calls.some((c) => c.includes("labels/nedbruten") || c.includes("labels[]="))).toBe(false);
    expect(gh.calls.some((c) => c.includes("/comments") && c.includes("redan nedbruten"))).toBe(true);
  });

  it("i rapportläge ändras inget", () => {
    const gh = fakeGh({ "/events": [[ghEvent(1, "granskad", true)]] });
    const d = handleLabel(flow, payload("granskad", ["granskad"], true), gitHub("ulrik-s/ava", gh.run), false, () => {});
    expect(d).toEqual({ kind: "allow", remove: [] });
    expect(gh.calls.filter((c) => !c.includes("/events"))).toEqual([]);
  });

  it("okänt repo eller saknad händelse ignoreras", () => {
    const gh = fakeGh({ "/events": [[]] });
    expect(handleLabel(flow, { label: { name: "x" }, repository: { full_name: "x/y" } }, gitHub("x/y", gh.run), true, () => {})).toEqual({ kind: "ignore" });
    expect(handleLabel(flow, payload("granskad", ["granskad"], true), gitHub("ulrik-s/ava", gh.run), true, () => {})).toEqual({ kind: "ignore" });
  });

  it("städar saker med flera tillstånd", () => {
    const gh = fakeGh({ "/issues?state=open": [[{ number: 2, labels: [{ name: "undersökt" }, { name: "nedbruten" }] }, { number: 3, labels: [{ name: "nedbruten" }] }, { number: 4, labels: [], pull_request: {} }]] });
    expect(normalize(intake, gitHub("ulrik-s/ava-feedback", gh.run), true, () => {})).toBe(1);
    expect(gh.calls.some((c) => c.includes("issues/2/labels/unders%C3%B6kt"))).toBe(true);
    expect(normalize(intake, gitHub("ulrik-s/ava-feedback", fakeGh({ "/issues?state=open": [[{ number: 2, labels: [{ name: "undersökt" }, { name: "nedbruten" }] }]] }).run), false, () => {})).toBe(1);
  });
});

describe("klockan mot GitHub", () => {
  const now = new Date("2026-11-20T12:00:00Z").getTime();

  it("lägger tillbaka en övergiven pågår-issue i kön", () => {
    const gh = fakeGh({
      "/issues?state=open": [[{ number: 5, labels: [{ name: "pågår" }, { name: "agent-task" }] }, { number: 6, labels: [{ name: "granskad" }] }]],
      "/events": [[ghEvent(1, "pågår", true)]],
      "search/issues": { total_count: 0 },
    });
    const lines: string[] = [];
    const actions = runTimeouts(codeIssue, gitHub("ulrik-s/ava", gh.run), now, true, (l) => lines.push(l));
    expect(actions).toHaveLength(1);
    expect(gh.calls.some((c) => c.includes("labels[]=granskad"))).toBe(true);
    expect(gh.calls.some((c) => c.includes("/comments"))).toBe(true);
    expect(lines[0]).toContain("#5");
  });

  it("tar bort en utgången flagga utan att lägga till något, och rapporterar bara i rapportläge", () => {
    const old = { ...ghEvent(1, "väntar-på-användaren", true), created_at: "2026-11-01T00:00:00Z" };
    const gh = fakeGh({ "/issues?state=open": [[{ number: 8, labels: [{ name: "väntar-på-användaren" }] }]], "/events": [[old]] });
    expect(runTimeouts(intake, gitHub("ulrik-s/ava-feedback", gh.run), now, false, () => {})).toHaveLength(1);
    expect(gh.calls.filter((c) => c.includes("DELETE"))).toEqual([]);
  });

  it("avbryter CI som hänger", () => {
    const gh = fakeGh({
      "status=queued": { workflow_runs: [] },
      "status=in_progress": { workflow_runs: [{ id: 42, status: "in_progress", run_started_at: "2026-11-20T09:00:00Z" }] },
    });
    expect(cancelHung(gitHub("ulrik-s/ava", gh.run), now, 60, true, () => {})).toEqual([42]);
    expect(gh.calls.some((c) => c.includes("actions/runs/42/cancel"))).toBe(true);
    expect(cancelHung(gitHub("ulrik-s/ava", gh.run), now, 60, false, () => {})).toEqual([42]);
  });

  // Dygnstaket (#2027): taket + 2 PR:er på en timme i går → #30 var sist, över taket, när den skapades.
  const burst = Array.from({ length: AGENT_PR_PER_DAY + 2 }, (_, i) => new Date(Date.parse("2026-11-19T10:00:00Z") + i * 2 * 60_000).toISOString());
  const lastInBurst = burst.at(-1) ?? "";
  const pullsOpen = (labels: string[]) => [[
    { number: 30, title: "t", body: "Closes #3", labels: labels.map((name) => ({ name })), created_at: lastInBurst },
    { number: 31, title: "t", body: "Closes #4", labels: [{ name: "agent-pr" }, { name: "granskad" }], created_at: "2026-11-20T11:00:00Z" },
  ]];

  const capLog = (cap: number, rank: number): string => `2026-11-19T11:30:01.0000000Z ✗ Taket är ${cap} agent-PR:er per dygn — den här är nr ${rank}.\n##[error]Process completed with exit code 1.`;
  const failedRuns = { check_runs: [
    { conclusion: "success", started_at: "2026-11-19T11:06:00Z", details_url: "https://github.com/x/actions/runs/1/job/66" },
    { conclusion: "failure", started_at: "2026-11-19T11:30:00Z", details_url: "https://github.com/x/actions/runs/2/job/77" },
  ] };
  const answers = (opts: { labels?: string[]; conclusion?: string; log?: string; createdAts?: string[] } = {}) => ({
    "search/issues": { items: (opts.createdAts ?? burst).map((created_at) => ({ created_at })) },
    "pulls?state=open": pullsOpen(opts.labels ?? ["agent-pr", "granskad"]),
    "repos/ulrik-s/ava/pulls/30": { head: { sha: "abc" } },
    "check-runs": opts.conclusion === undefined ? failedRuns
      : { check_runs: [{ conclusion: opts.conclusion, started_at: "2026-11-19T11:30:00Z", details_url: "https://github.com/x/actions/runs/2/job/77" }] },
    "jobs/77/logs": opts.log ?? capLog(AGENT_PR_PER_DAY, AGENT_PR_PER_DAY + 2),
  });

  it("klockan kör om Agentvakten på en granskad PR som bara föll på taket, och bara den", () => {
    const gh = fakeGh(answers());
    const lines: string[] = [];
    expect(rerunReleasedFromCap(gitHub("ulrik-s/ava", gh.run), now, true, (l) => lines.push(l))).toEqual([30]);
    expect(gh.calls.filter((c) => c.includes("/rerun"))).toEqual(["api -X POST repos/ulrik-s/ava/actions/jobs/77/rerun"]);
    expect(lines[0]).toContain("PR #30");
  });

  it("en PR som föll på ett gamla, lägre tak körs om nu när den är under det nya (#2158)", () => {
    const createdAts = burst.slice(0, 22); // nr 22: över taket 20 då, under 30 nu
    const gh = fakeGh(answers({ createdAts, log: capLog(20, 22) }));
    const pulls = [[{ number: 30, title: "t", body: "Closes #3", labels: [{ name: "agent-pr" }, { name: "granskad" }], created_at: createdAts.at(-1) }]];
    const run: GhRunner = (args) => (args.join(" ").includes("pulls?state=open") ? JSON.stringify(pulls) : gh.run(args));
    expect(rerunReleasedFromCap(gitHub("ulrik-s/ava", run), Date.parse("2026-11-19T12:00:00Z"), true, () => {})).toEqual([30]);
    expect(gh.calls.some((c) => c.includes("actions/jobs/77/rerun"))).toBe(true);
  });

  it("klockans räkning hoppar över blockerade och stängda PR:er, som Agentvakten (2026-11-27)", () => {
    const items = [
      { created_at: "2026-11-19T10:00:00Z", state: "closed", labels: [], pull_request: { merged_at: "2026-11-19T12:00:00Z" } },
      { created_at: "2026-11-19T10:01:00Z", state: "open", labels: [{ name: "agent-pr" }] },
      { created_at: "2026-11-19T10:02:00Z", state: "open", labels: [{ name: "blockerad" }] },
      { created_at: "2026-11-19T10:03:00Z", state: "closed", labels: [], pull_request: { merged_at: null } },
    ];
    const gh = gitHub("ulrik-s/ava", fakeGh({ "search/issues": { items } }).run);
    expect(gh.agentPullsCreatedSince("2026-11-18T00:00:00Z")).toEqual(["2026-11-19T10:00:00Z", "2026-11-19T10:01:00Z"]);
  });

  it("inget att köra om: blockerad, ogranskad, grön Agentvakt, annat skäl, över taket, eller rapportläge", () => {
    const check = (opts: Parameters<typeof answers>[0], enforce = true, at = now) => {
      const gh = fakeGh(answers(opts));
      const out = rerunReleasedFromCap(gitHub("ulrik-s/ava", gh.run), at, enforce, () => {});
      expect(gh.calls.some((c) => c.includes("/rerun"))).toBe(false);
      return out;
    };
    expect(check({ labels: ["agent-pr", "granskad", "blockerad"] })).toEqual([]);
    expect(check({ labels: ["agent-pr", "att-granska"] })).toEqual([]);
    expect(check({ conclusion: "success" })).toEqual([]);
    expect(check({ log: `${capLog(AGENT_PR_PER_DAY, 31)}\n✗ Skyddad sökväg: .github/x.yml (kräver etiketten människa-godkänd).` })).toEqual([]);
    expect(check({}, true, Date.parse(lastInBurst) + 60_000)).toEqual([]); // fortfarande över taket
    expect(check({}, false)).toEqual([]);
  });

  it("failedCheckLog: null för en grön senaste körning, loggtexten för en röd", () => {
    expect(gitHub("ulrik-s/ava", fakeGh(answers({ conclusion: "success" })).run).failedCheckLog(30, "Agentvakt")).toBeNull();
    expect(gitHub("ulrik-s/ava", fakeGh(answers({ log: "loggen" })).run).failedCheckLog(30, "Agentvakt")).toBe("loggen");
  });

  it.each([
    ["läses", "jobs/77/logs"],
    ["körs om", "/rerun"],
  ])("ett fel när loggen %s loggas och stoppar inte klockan", (_label, failing) => {
    const gh = fakeGh(answers());
    const run: GhRunner = (args) => {
      if (args.join(" ").includes(failing)) throw new Error("HTTP 403");
      return gh.run(args);
    };
    const lines: string[] = [];
    expect(rerunReleasedFromCap(gitHub("ulrik-s/ava", run), now, true, (l) => lines.push(l))).toEqual([]);
    expect(lines[0]).toContain("kunde inte köras om");
  });
});

describe("händelsestyrningen", () => {
  type Call = { url: string; headers: Record<string, string> };
  const okFetch = (calls: Call[]): FetchFn => (url, init) => {
    calls.push({ url, headers: init.headers });
    return Promise.resolve({ ok: true, status: 200 });
  };
  const payload = (label: string) => ({ label: { name: label }, repository: { full_name: "ulrik-s/ava-feedback" }, issue: { number: 4, labels: [{ name: label }] } });

  it("startar tillståndets agent, men inte för tillstånd agenten sätter själv eller för flaggor", () => {
    expect(dispatchTarget(flow, intake, "verifierad")?.id).toBe("L2");
    expect(dispatchTarget(flow, intake, "nedbruten")).toBeNull();
    expect(dispatchTarget(flow, intake, "levererad")).toBeNull();
    expect(dispatchTarget(flow, intake, "blockerad")).toBeNull();
    expect(dispatchTarget(flow, codeIssue, "granskad")?.id).toBe("L4");
  });

  it("utan token händer inget", async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    expect(await dispatchLabel(flow, payload("verifierad"), {}, { fetch: okFetch(calls), log: (l) => lines.push(l) })).toBe(false);
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("ingen ROUTINE_TOKEN_L2");
  });

  it("med token startas rutinen via /fire", async () => {
    const calls: Call[] = [];
    expect(await dispatchLabel(flow, payload("verifierad"), { ROUTINE_TOKEN_L2: "t" }, { fetch: okFetch(calls), log: () => {} })).toBe(true);
    expect(calls[0]?.url).toContain("trig_01TnVuo291SKkYqn3f8752qn/fire");
    expect(calls[0]?.headers.Authorization).toBe("Bearer t");
  });

  // Låset: flera etiketter i följd startar samma loop bara en gång.
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const lev = (id: number, number: number, label: string, msAgo = 60_000, isPr = false) => ({ id, number, label, isPr, at: at(msAgo) });
  const routineOf = (e: { label: string; isPr: boolean }) => dispatchTarget(flow, e.isPr ? codePr : intake, e.label)?.id ?? null;

  it("earlierFire: den första händelsen i fönstret vinner, senare och gamla räknas inte", () => {
    const events = [lev(30, 6, "verifierad"), lev(20, 5, "verifierad"), lev(10, 4, "verifierad", FIRE_WINDOW_MS + 60_000)];
    expect(earlierFire(events, { own: { number: 6, label: "verifierad", isPr: false }, routineId: "L2", routineOf, now: Date.now() })?.number).toBe(5);
    // #5 är den äldsta inom fönstret (#4 ligger utanför) → den startar.
    expect(earlierFire(events, { own: { number: 5, label: "verifierad", isPr: false }, routineId: "L2", routineOf, now: Date.now() })).toBeNull();
    // En annan rutin (eller en flagga) låser inte.
    expect(earlierFire([lev(20, 5, "bugg")], { own: { number: 6, label: "verifierad", isPr: false }, routineId: "L2", routineOf, now: Date.now() })).toBeNull();
    // Den egna händelsen syns inte än i loggen → räknas som nyast.
    expect(earlierFire([lev(20, 5, "verifierad")], { own: { number: 9, label: "verifierad", isPr: false }, routineId: "L2", routineOf, now: Date.now() })?.number).toBe(5);
  });

  it("earlierFire med parallel (#1837): upp till så många saker startar, men aldrig samma sak två gånger", () => {
    const q = (number: number) => ({ own: { number, label: "verifierad", isPr: false }, routineId: "L2", routineOf, now: Date.now(), parallel: 3 });
    const events = [lev(40, 8, "verifierad"), lev(30, 7, "verifierad"), lev(20, 6, "verifierad"), lev(10, 5, "verifierad")];
    expect(earlierFire(events, q(5))).toBeNull();
    expect(earlierFire(events, q(7))).toBeNull();
    // Tre startade redan (#5, #6, #7) → den fjärde stängs ute av den tredje.
    expect(earlierFire(events, q(8))).not.toBeNull();
    // Samma sak tidigare i fönstret → stängs ute även under taket.
    expect(earlierFire([lev(30, 5, "verifierad"), lev(20, 5, "verifierad")], q(5))?.id).toBe(20);
  });

  it("repots etiketthändelser och öppna PR:er läses från GitHub", () => {
    const gh = fakeGh({
      "issues/events": [
        { id: 3, event: "labeled", created_at: "2026-11-17T10:00:00Z", label: { name: "granskad" }, issue: { number: 7, pull_request: {} } },
        { id: 2, event: "unlabeled", created_at: "2026-11-17T09:59:00Z", label: { name: "x" }, issue: { number: 6 } },
        { id: 1, event: "labeled", created_at: "2026-11-17T09:58:00Z", label: { name: "verifierad" }, issue: { number: 5 } },
      ],
      "pulls?state=open": [[{ number: 7, title: "PR", body: null, labels: [{ name: "agent-pr" }] }]],
    });
    const api = gitHub("ulrik-s/ava", gh.run);
    expect(api.recentLabelEvents()).toEqual([
      { id: 3, label: "granskad", number: 7, isPr: true, at: "2026-11-17T10:00:00Z" },
      { id: 1, label: "verifierad", number: 5, isPr: false, at: "2026-11-17T09:58:00Z" },
    ]);
    expect(api.openPulls()).toEqual([{ number: 7, title: "PR", body: "", labels: ["agent-pr"], isPr: true, createdAt: "" }]);
  });

  it("dispatchLabel med låset: en tidigare start i fönstret → ingen ny körning", async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    const events = () => [lev(20, 4, "verifierad"), lev(10, 3, "verifierad")];
    expect(await dispatchLabel(flow, payload("verifierad"), { ROUTINE_TOKEN_L2: "t" }, { fetch: okFetch(calls), log: (l) => lines.push(l), recentEvents: events })).toBe(false);
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("L2: redan startad av #3");
    // Ingen tidigare i fönstret → startar.
    expect(await dispatchLabel(flow, payload("verifierad"), { ROUTINE_TOKEN_L2: "t" }, { fetch: okFetch(calls), log: () => {}, recentEvents: () => [lev(20, 4, "verifierad")] })).toBe(true);
  });

  it("går låset inte att läsa startas rutinen ändå, och felet loggas (#1774)", async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    const broken = (): never => { throw new Error("gh api repos/ulrik-s/ava/issues/events: avslutades med SIGTERM"); };
    expect(await dispatchLabel(flow, payload("verifierad"), { ROUTINE_TOKEN_L2: "t" }, { fetch: okFetch(calls), log: (l) => lines.push(l), recentEvents: broken })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(lines[0]).toBe("låset gick inte att läsa (gh api repos/ulrik-s/ava/issues/events: avslutades med SIGTERM) — startar ändå");
  });

  it("ingen agent att starta: inget anrop", async () => {
    const calls: Call[] = [];
    expect(await dispatchLabel(flow, payload("bugg"), { ROUTINE_TOKEN_L2: "t" }, { fetch: okFetch(calls), log: () => {} })).toBe(false);
    expect(await dispatchLabel(flow, { label: { name: "x" }, repository: { full_name: "x/y" } }, {}, { fetch: okFetch(calls), log: () => {} })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("knuffen", () => {
  const now = new Date("2026-11-20T12:00:00Z").getTime();
  const item = (labels: string[], hoursAgo: number) => ({
    number: 3, labels, hasOpenPr: false,
    labeledAt: Object.fromEntries(labels.map((l) => [l, new Date(now - hoursAgo * 3_600_000 - 60_000).toISOString()])),
  });

  it("knuffar en sak som stått still i ett agenttillstånd, en gång per period", () => {
    expect(dueNudges(codePr, flow.nudge, [item(["behöver-ändras"], 2)], now)).toEqual([{ number: 3, label: "behöver-ändras", hours: 2 }]);
    expect(dueNudges(codePr, flow.nudge, [item(["behöver-ändras"], 3)], now)).toEqual([]);
    expect(dueNudges(codePr, flow.nudge, [item(["behöver-ändras"], 4)], now)).toHaveLength(1);
    expect(dueNudges(codePr, flow.nudge, [item(["behöver-ändras"], 1)], now)).toEqual([]);
  });

  it("knuffar inte det som väntar på en människa, tillstånd utan agent eller utan tidpunkt", () => {
    expect(dueNudges(codePr, flow.nudge, [item(["behöver-ändras", "blockerad"], 2)], now)).toEqual([]);
    expect(dueNudges(intake, flow.nudge, [item(["undersökt"], 2)], now)).toEqual([]);
    expect(dueNudges(intake, flow.nudge, [item(["nedbruten"], 2)], now)).toEqual([]);
    expect(dueNudges(codePr, flow.nudge, [{ number: 3, labels: ["behöver-ändras"], labeledAt: {}, hasOpenPr: false }], now)).toEqual([]);
  });

  it("startar agenten med token, loggar utan", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = (url) => { urls.push(url); return Promise.resolve({ ok: true, status: 200 }); };
    const lines: string[] = [];
    expect(await runNudges(flow, codePr, [item(["behöver-ändras"], 2)], { now, env: { ROUTINE_TOKEN_L4: "t" }, fetchFn, log: (l) => lines.push(l), started: new Map() })).toBe(1);
    expect(urls[0]).toContain("trig_019KfqBDJkYMiLG43Dr7QMo2/fire");
    expect(lines[0]).toContain("knuff L4");
    expect(await runNudges(flow, codePr, [item(["behöver-ändras"], 2)], { now, env: {}, fetchFn, log: () => {}, started: new Map() })).toBe(0);
  });

  it("startar en rutin högst `parallel` gånger per klockkörning, även över maskiner (#1681, #1837)", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = (url) => { urls.push(url); return Promise.resolve({ ok: true, status: 200 }); };
    const lines: string[] = [];
    const ctx = { now, env: { ROUTINE_TOKEN_L4: "t" }, fetchFn, log: (l: string) => lines.push(l), started: new Map<string, number>() };
    const four = [3, 4, 5, 6].map((number) => ({ ...item(["behöver-ändras"], 2), number }));
    expect(await runNudges(flow, codePr, four, ctx)).toBe(1);
    expect(urls).toHaveLength(1);
    expect(lines.filter((l) => l.includes("redan startad"))).toHaveLength(3);
    expect(await runNudges(flow, codePr, [item(["behöver-ändras"], 2)], ctx)).toBe(0);
  });
});

describe("dubblett-PR:er (#1681)", () => {
  const pull = (number: number, issue: number, createdAt: string) => ({ number, issue, createdAt });

  it("läser Closes #N ur bodyn, exakt nummer", () => {
    expect(closesIssue("Fixar menyn.\n\nCloses #1646")).toBe(1646);
    expect(closesIssue("Closes #16460")).toBe(16460);
    expect(closesIssue("Ingen koppling")).toBeNull();
  });

  it("den mergade eller äldsta behålls; en PR skapad efter mergen är ett omtag", () => {
    const merged = new Map([[1646, { number: 1665, mergedAt: "2026-11-17T21:08:00Z" }]]);
    const open = [pull(1666, 1646, "2026-11-17T20:50:57Z"), pull(1668, 1647, "2026-11-17T21:01:00Z"), pull(1690, 1647, "2026-11-17T21:05:00Z")];
    expect(duplicatePulls(open, merged)).toEqual([{ number: 1666, keep: 1665 }, { number: 1690, keep: 1668 }]);
    expect(duplicatePulls([pull(1700, 1646, "2026-11-18T09:00:00Z")], merged)).toEqual([]);
  });

  it("agent-pr är en flagga i flödet", () => {
    expect(codePr.flags[AGENT_PR]).toBeDefined();
  });

  it("klockan stänger dubbletterna med en kommentar; i rapportläge ändras inget", () => {
    const pr = (number: number, issue: number, createdAt: string, labels = [AGENT_PR]) =>
      ({ number, title: "t", body: `Text\n\nCloses #${issue}`, labels: labels.map((name) => ({ name })), created_at: createdAt });
    const answers = {
      "pulls?state=open": [[pr(1666, 1646, "2026-11-17T20:50:57Z"), pr(1668, 1647, "2026-11-17T21:01:00Z"), pr(1690, 1647, "2026-11-17T21:05:00Z"), pr(1700, 1646, "2026-11-17T20:00:00Z", [])]],
      "is:merged": { items: [
        { number: 1665, body: "Closes #1646", pull_request: { merged_at: "2026-11-17T21:08:00Z" } },
        { number: 1600, body: "Closes #1646", pull_request: { merged_at: null } },
        { number: 1601, body: "Closes #16460", pull_request: { merged_at: "2026-11-18T00:00:00Z" } },
      ] },
    };
    const gh = fakeGh(answers);
    const lines: string[] = [];
    expect(closeDuplicatePulls(gitHub("ulrik-s/ava", gh.run), true, (l) => lines.push(l))).toEqual([{ number: 1666, keep: 1665 }, { number: 1690, keep: 1668 }]);
    expect(gh.calls.filter((c) => c.includes("state=closed"))).toEqual([
      "api -X PATCH repos/ulrik-s/ava/pulls/1666 -f state=closed",
      "api -X PATCH repos/ulrik-s/ava/pulls/1690 -f state=closed",
    ]);
    expect(gh.calls.some((c) => c.includes("issues/1666/comments") && c.includes("dubblett av #1665"))).toBe(true);
    expect(lines[0]).toContain("#1666: dubblett av #1665");
    const report = fakeGh(answers);
    expect(closeDuplicatePulls(gitHub("ulrik-s/ava", report.run), false, () => {})).toHaveLength(2);
    expect(report.calls.some((c) => c.includes("state=closed") || c.includes("/comments"))).toBe(false);
  });
});

describe("etiketter som redan är borta", () => {
  const failing = (message: string): GhRunner => (args) => {
    if (args.includes("DELETE")) throw new Error(message);
    return "{}";
  };

  it("en etikett som redan tagits bort (404) är inget fel", () => {
    expect(() => gitHub("ulrik-s/ava", failing("gh api: Label does not exist (HTTP 404)")).removeLabel(1, "att-granska")).not.toThrow();
  });

  it("andra fel kastas vidare", () => {
    expect(() => gitHub("ulrik-s/ava", failing("gh api: Bad credentials (HTTP 401)")).removeLabel(1, "att-granska")).toThrow("HTTP 401");
  });
});
