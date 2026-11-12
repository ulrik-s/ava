/**
 * Agentkedjans flöde (tooling/agents/flow.yaml): filen hänger ihop, de
 * genererade filerna är aktuella, flödesvakten släpper bara tillåtna
 * övergångar och klockan verkställer timeouterna.
 */
import { describe, expect, it } from "vitest-compat";
import { INTAKE_LABELS } from "@/lib/shared/feedback";
import { dispatchTarget, type FetchFn } from "../../tooling/scripts/flow/dispatch";
import { renderMermaid } from "../../tooling/scripts/flow/generate";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { flowErrors, loadFlow, parseFlow } from "../../tooling/scripts/flow/load";
import type { Flow, Machine } from "../../tooling/scripts/flow/schema";
import { decide, type LabelEvent, normalizeRemovals, previousStateLabel } from "../../tooling/scripts/flow/transition";
import { dueTimeouts, hungRuns, parseDuration } from "../../tooling/scripts/flow/watchdog";
import { expectedFiles, staleFiles } from "../../tooling/scripts/flow-gen";
import { dispatchLabel, handleLabel, machineFor, normalize } from "../../tooling/scripts/flow-guard";
import { cancelHung, runTimeouts } from "../../tooling/scripts/flow-watchdog";

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

  it("labels.json och docs/agent-flow.md är genererade ur den aktuella filen", () => {
    expect(staleFiles(expectedFiles())).toEqual([]);
  });

  it("AVA:s statusetiketter (feedback.ts) finns alla i intagets flöde", () => {
    const known = new Set([...Object.values(intake.states).map((s) => s.label), ...Object.keys(intake.flags)]);
    expect(Object.values(INTAKE_LABELS).filter((l) => !known.has(l))).toEqual([]);
  });

  it("hittar trasiga övergångar, dubbla etiketter, onåbara tillstånd och okända agenter", () => {
    const broken = parseFlow(`
version: 1
ulrik: u
ci: { hang_minutes: 5 }
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
    for (const part of ["starttillståndet saknas", "övergången till b", "timeouten går till c", "används två gånger", "saknar färg", "går inte att nå", "agenten L9", "olika färg"]) {
      expect(errors).toContain(part);
    }
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

  it("föregående tillstånd räknas fram ur händelseloggen, inklusive vaktens egna borttagningar", () => {
    const events = [ev(1, "att-granska"), ev(2, "granskad"), ev(3, "att-granska", false), ev(4, "pågår"), ev(5, "agent-task")];
    expect(previousStateLabel(events, 4, codeIssue)).toBe("granskad");
    expect(previousStateLabel(events, 2, codeIssue)).toBe("att-granska");
    expect(previousStateLabel([ev(1, "att-granska"), ev(2, "att-granska", false)], 3, codeIssue)).toBeNull();
    expect(previousStateLabel([ev(1, "undersökt"), ev(2, "verifierad")], 3, intake)).toBe("verifierad");
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
    return key === undefined ? "{}" : JSON.stringify(answers[key]);
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
    expect(await dispatchLabel(flow, payload("verifierad"), {}, okFetch(calls), (l) => lines.push(l))).toBe(false);
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("ingen ROUTINE_TOKEN_L2");
  });

  it("med token startas rutinen via /fire", async () => {
    const calls: Call[] = [];
    expect(await dispatchLabel(flow, payload("verifierad"), { ROUTINE_TOKEN_L2: "t" }, okFetch(calls), () => {})).toBe(true);
    expect(calls[0]?.url).toContain("trig_01TnVuo291SKkYqn3f8752qn/fire");
    expect(calls[0]?.headers.Authorization).toBe("Bearer t");
  });

  it("ingen agent att starta: inget anrop", async () => {
    const calls: Call[] = [];
    expect(await dispatchLabel(flow, payload("bugg"), { ROUTINE_TOKEN_L2: "t" }, okFetch(calls), () => {})).toBe(false);
    expect(await dispatchLabel(flow, { label: { name: "x" }, repository: { full_name: "x/y" } }, {}, okFetch(calls), () => {})).toBe(false);
    expect(calls).toEqual([]);
  });
});
