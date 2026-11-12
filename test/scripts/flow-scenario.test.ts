/**
 * Scenariotest av agentkedjans flöde: en förfrågan och en implementation går
 * hela vägen genom flödesvakten och klockan mot ett GitHub i minnet. Fångar
 * fel som bara syns i samspelet — en etikett som redan är borttagen, en
 * missad händelse, en blockerad sak — innan de når produktion.
 */
import { describe, expect, it } from "vitest-compat";
import type { FetchFn } from "../../tooling/scripts/flow/dispatch";
import { gitHub, type GhRunner } from "../../tooling/scripts/flow/github";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { handleLabel } from "../../tooling/scripts/flow-guard";
import { cancelHung, runNudges, runTimeouts, watchItems } from "../../tooling/scripts/flow-watchdog";

const flow = loadFlow();
const HOUR = 3_600_000;

interface FakeIssue { number: number; labels: string[]; isPr: boolean; body: string; open: boolean }
interface FakeEvent { id: number; event: string; created_at: string; label: { name: string }; actor: { login: string }; performed_via_github_app: unknown }

/** Ett GitHub i minnet: etiketter, händelselogg, kommentarer. */
class FakeGitHub {
  readonly issues = new Map<number, FakeIssue>();
  readonly events = new Map<number, FakeEvent[]>();
  readonly comments: Array<{ number: number; body: string }> = [];
  private nextId = 1;
  /** Vem som gör ändringarna: en agent (via appen) eller Ulrik själv. */
  viaApp = true;
  now = new Date("2026-11-20T08:00:00Z").getTime();

  constructor(readonly repo: string) {}

  add(number: number, labels: string[] = [], isPr = false, body = ""): FakeIssue {
    const issue = { number, labels: [], isPr, body, open: true };
    this.issues.set(number, issue);
    for (const l of labels) this.label(number, l);
    return issue;
  }

  label(n: number, name: string): void {
    const issue = this.must(n);
    if (!issue.labels.includes(name)) issue.labels.push(name);
    this.log(n, "labeled", name);
  }

  unlabel(n: number, name: string): void {
    const issue = this.must(n);
    if (!issue.labels.includes(name)) throw new Error(`gh: Label does not exist (HTTP 404)`);
    issue.labels = issue.labels.filter((l) => l !== name);
    this.log(n, "unlabeled", name);
  }

  /** Det flödesvakten får när en etikett just satts. */
  payload(n: number, label: string): Parameters<typeof handleLabel>[1] {
    const issue = this.must(n);
    const item = { number: n, labels: issue.labels.map((name) => ({ name })) };
    return { label: { name: label }, repository: { full_name: this.repo }, ...(issue.isPr ? { pull_request: item } : { issue: item }) };
  }

  readonly run: GhRunner = (args) => {
    const line = args.join(" ");
    const num = (re: RegExp): number => Number(re.exec(line)?.[1]);
    if (line.includes("/events")) return JSON.stringify([this.events.get(num(/issues\/(\d+)\/events/)) ?? []]);
    if (line.includes("issues?state=open")) {
      return JSON.stringify([[...this.issues.values()].filter((i) => i.open).map((i) => ({ number: i.number, labels: i.labels.map((name) => ({ name })), ...(i.isPr ? { pull_request: {} } : {}) }))]);
    }
    if (line.includes("-X DELETE")) {
      this.unlabel(num(/issues\/(\d+)\/labels/), decodeURIComponent(line.split("/labels/")[1] ?? ""));
      return "[]";
    }
    if (line.includes("/labels")) { this.label(num(/issues\/(\d+)\/labels/), line.split("labels[]=")[1] ?? ""); return "[]"; }
    if (line.includes("/comments")) { this.comments.push({ number: num(/issues\/(\d+)\/comments/), body: line.split("body=")[1] ?? "" }); return "{}"; }
    if (line.includes("search/issues")) {
      const target = num(/Closes #(\d+)/);
      return JSON.stringify({ total_count: [...this.issues.values()].filter((i) => i.isPr && i.open && i.body.includes(`Closes #${target}`)).length });
    }
    return "{}";
  };

  private must(n: number): FakeIssue {
    const issue = this.issues.get(n);
    if (!issue) throw new Error(`saknar #${n}`);
    return issue;
  }

  private log(n: number, event: string, name: string): void {
    const list = this.events.get(n) ?? [];
    list.push({
      id: this.nextId++, event, created_at: new Date(this.now).toISOString(), label: { name },
      actor: { login: "ulrik-s" }, performed_via_github_app: this.viaApp ? { slug: "claude" } : null,
    });
    this.events.set(n, list);
  }
}

/** En agent eller Ulrik sätter en etikett; flödesvakten reagerar som i Actions. */
function setLabel(gh: FakeGitHub, n: number, label: string, opts: { byUlrik?: boolean } = {}) {
  gh.viaApp = !opts.byUlrik;
  gh.label(n, label);
  gh.viaApp = false; // vaktens egna ändringar görs med repots token
  const decision = handleLabel(flow, gh.payload(n, label), gitHub(gh.repo, gh.run), true, () => {});
  gh.viaApp = true;
  return decision;
}

const noFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200 });

describe("scenario: en förfrågan i intaget", () => {
  it("mottagen → undersökt → (agenten stoppas) → verifierad av Ulrik → nedbruten → levererad, alltid ett tillstånd", () => {
    const gh = new FakeGitHub("ulrik-s/ava-feedback");
    gh.add(10, ["user-request", "bugg"]);
    const states = () => gh.issues.get(10)?.labels.filter((l) => ["undersökt", "verifierad", "nedbruten", "levererad", "dubblett"].includes(l));

    expect(setLabel(gh, 10, "undersökt").kind).toBe("allow");
    expect(states()).toEqual(["undersökt"]);

    // En agent försöker verifiera själv: stoppas, undersökt läggs tillbaka, en kommentar förklarar.
    expect(setLabel(gh, 10, "verifierad").kind).toBe("reject");
    expect(states()).toEqual(["undersökt"]);
    expect(gh.comments.at(-1)?.body).toContain("Bara Ulrik");

    expect(setLabel(gh, 10, "verifierad", { byUlrik: true }).kind).toBe("allow");
    expect(states()).toEqual(["verifierad"]);
    expect(setLabel(gh, 10, "nedbruten").kind).toBe("allow");
    expect(setLabel(gh, 10, "levererad").kind).toBe("allow");
    expect(states()).toEqual(["levererad"]);
    expect(gh.issues.get(10)?.labels).toEqual(expect.arrayContaining(["user-request", "bugg"]));
  });

  it("en fråga som aldrig besvaras tas bort efter 7 dagar", () => {
    const gh = new FakeGitHub("ulrik-s/ava-feedback");
    gh.add(11, ["user-request", "väntar-på-användaren"]);
    const intake = flow.machines.intake;
    if (!intake) throw new Error("saknar intake");
    gh.now += 6 * 24 * HOUR;
    expect(runTimeouts(intake, gitHub(gh.repo, gh.run), gh.now, true, () => {})).toEqual([]);
    gh.now += 2 * 24 * HOUR;
    expect(runTimeouts(intake, gitHub(gh.repo, gh.run), gh.now, true, () => {})).toHaveLength(1);
    expect(gh.issues.get(11)?.labels).not.toContain("väntar-på-användaren");
  });
});

describe("scenario: en implementation i ava", () => {
  const codeIssue = flow.machines["code-issue"];
  const codePr = flow.machines["code-pr"];
  if (!codeIssue || !codePr) throw new Error("saknar maskiner");

  it("att-granska → granskad → pågår; en etikett som agenten redan tagit bort fäller inte vakten", () => {
    const gh = new FakeGitHub("ulrik-s/ava");
    gh.add(20, ["agent-task"]);
    expect(setLabel(gh, 20, "att-granska").kind).toBe("allow");
    // Agenten tar själv bort att-granska innan den sätter granskad — vakten försöker ta bort den igen.
    gh.unlabel(20, "att-granska");
    expect(() => setLabel(gh, 20, "granskad")).not.toThrow();
    expect(setLabel(gh, 20, "pågår").kind).toBe("allow");
    expect(gh.issues.get(20)?.labels).toEqual(["agent-task", "pågår"]);
  });

  it("en övergiven pågår (ingen PR på 4 h) går tillbaka i kön; med öppen PR står den kvar", () => {
    const gh = new FakeGitHub("ulrik-s/ava");
    gh.add(21, ["agent-task", "granskad", "pågår"]);
    gh.add(22, ["agent-task", "granskad", "pågår"]);
    gh.add(122, ["agent-pr", "att-granska"], true, "Closes #22");
    gh.issues.get(21)?.labels.splice(1, 1);
    gh.issues.get(22)?.labels.splice(1, 1);
    gh.now += 5 * HOUR;
    runTimeouts(codeIssue, gitHub(gh.repo, gh.run), gh.now, true, () => {});
    expect(gh.issues.get(21)?.labels).toEqual(["agent-task", "granskad"]);
    expect(gh.issues.get(22)?.labels).toEqual(["agent-task", "pågår"]);
  });

  it("en missad händelse fångas av knuffen; det som väntar på Ulrik knuffas inte", async () => {
    const gh = new FakeGitHub("ulrik-s/ava");
    gh.add(30, ["agent-pr", "behöver-ändras"], true);
    gh.add(31, ["agent-pr", "behöver-ändras", "blockerad"], true);
    gh.now += 2 * HOUR + 60_000;
    const fired: string[] = [];
    const fetchFn: FetchFn = (url) => { fired.push(url); return noFetch(url, { method: "POST", headers: {}, body: "" }); };
    const items = watchItems(codePr, gitHub(gh.repo, gh.run));
    const started = await runNudges(flow, codePr, items, { now: gh.now, env: { ROUTINE_TOKEN_L4: "t" }, fetchFn, log: () => {} });
    expect(started).toBe(1);
    expect(fired).toHaveLength(1);
  });
});

describe("scenario: CI som hänger", () => {
  it("en spökkörning som inte går att avbryta (409) stoppar inte klockan", () => {
    const run: GhRunner = (args) => {
      const line = args.join(" ");
      if (line.includes("/cancel")) throw new Error("gh: Cannot cancel a workflow run that has not been queued yet. (HTTP 409)");
      if (line.includes("status=queued")) return JSON.stringify({ workflow_runs: [{ id: 1, status: "queued", run_started_at: "2026-11-01T00:00:00Z" }] });
      return JSON.stringify({ workflow_runs: [] });
    };
    const lines: string[] = [];
    expect(cancelHung(gitHub("ulrik-s/ava", run), Date.parse("2026-11-20T00:00:00Z"), 60, true, (l) => lines.push(l))).toEqual([1]);
    expect(lines.at(-1)).toContain("kunde inte avbrytas");
  });
});
