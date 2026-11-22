/**
 * Projekttavlan: kort följer etiketterna, och Ulriks flyttar till Godkänd och
 * Avböjd blir beslut (verifierad, eller stängd). Prioriteten kan ändras på
 * tavlan. Synken läser av tavlan, eftersom GitHub inte kan starta en workflow
 * när ett kort flyttas.
 */
import { describe, expect, it } from "vitest-compat";
import {
  AUTO_APPROVE_MS, autoApprovable, autoApproveDue, COLUMN_LABELS, COLUMNS, columnFor, decideColumn, decidePrio, decideWorkOrder, isProposal, lageFor,
  proposalDue, rekFor, WORK_ORDER_LAGE,
} from "../../tooling/scripts/flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "../../tooling/scripts/flow/board-github";
import { gitHub, type GhRunner, intakeRefOf, type OpenItem } from "../../tooling/scripts/flow/github";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { BOARD_MARKER, type CodeSide, HUMAN_APPROVED, syncBoard } from "../../tooling/scripts/flow-board";

const flow = loadFlow();

describe("tavlans regler", () => {
  it("kolumnen följer etiketterna; det som väntar på någon går först", () => {
    expect(columnFor(["user-request"])).toBe("Ny");
    expect(columnFor(["undersökt"])).toBe("Att besluta");
    expect(columnFor(["undersökt", "blockerad"])).toBe("Svara");
    expect(columnFor(["väntar-på-användaren"])).toBe("Väntar på användaren");
    expect(columnFor(["verifierad"])).toBe("Godkänd");
    expect(columnFor(["nedbruten"])).toBe("Byggs");
    expect(columnFor(["dubblett"])).toBe("Byggs");
    expect(columnFor(["levererad"])).toBe("Klar");
    expect(columnFor(["finns-redan"])).toBe("Klar");
    expect(columnFor(["undersökt", "auto-godkänn"])).toBe("Godkänns automatiskt");
    expect(columnFor(["undersökt", "auto-godkänn", "verifierad"])).toBe("Godkänd");
    expect(columnFor(["designas"])).toBe("Designas");
    expect(columnFor(["design-granskas"])).toBe("Designas");
    expect(columnFor(["design-godkänd"])).toBe("Godkänd");
    expect(columnFor(["designas", "blockerad"])).toBe("Svara");
  });

  it("designvägen: avböjas går, godkännas igen går inte; Läge säger vilket steg", () => {
    expect(decideColumn(["designas"], "Avböjd")).toEqual({ kind: "decline" });
    expect(decideColumn(["designas"], "Godkänd")).toEqual({ kind: "set", column: "Designas" });
    expect(lageFor(["designas"])).toBe("Loop 2 designar lösningen (frågor hamnar i Svara)");
    expect(lageFor(["design-granskas"])).toBe("Designen granskas av loop 3 mot ADR:erna");
    expect(lageFor(["design-godkänd"])).toBe("Designen godkänd — loop 2 bryter ner den enligt designen");
  });

  it("etiketterna kolumnerna bygger på finns i intagets flöde", () => {
    const intake = flow.machines.intake;
    const known = new Set([...Object.values(intake?.states ?? {}).map((s) => s.label), ...Object.keys(intake?.flags ?? {})]);
    for (const l of COLUMN_LABELS) expect(known.has(l)).toBe(true);
    expect(COLUMNS.map((c) => c.name)).toContain("Godkänd");
  });

  it("flytten till Godkänd är ett beslut bara för det som inte är beslutat; annat läggs tillbaka", () => {
    expect(decideColumn(["undersökt"], "Att besluta")).toEqual({ kind: "none" });
    expect(decideColumn(["undersökt"], "Godkänd")).toEqual({ kind: "approve" });
    expect(decideColumn([], "Godkänd")).toEqual({ kind: "approve" });
    expect(decideColumn(["nedbruten"], "Godkänd")).toEqual({ kind: "set", column: "Byggs" });
    expect(decideColumn(["undersökt"], null)).toEqual({ kind: "set", column: "Att besluta" });
  });

  it("flytten till Avböjd stänger bara det där inget byggs ännu", () => {
    expect(decideColumn(["undersökt", "blockerad"], "Avböjd")).toEqual({ kind: "decline" });
    expect(decideColumn(["väntar-på-användaren"], "Avböjd")).toEqual({ kind: "decline" });
    expect(decideColumn(["verifierad"], "Avböjd")).toEqual({ kind: "set", column: "Godkänd" });
  });

  it("en agents förslag (#1872): auto-godkänn utan undersökt står i Godkänns automatiskt tills vetofönstret gått ut", () => {
    expect(isProposal(["designas", "auto-godkänn"])).toBe(true);
    expect(isProposal(["undersökt", "auto-godkänn"])).toBe(false);
    expect(isProposal(["designas"])).toBe(false);
    expect(columnFor(["verifierad", "auto-godkänn"])).toBe("Godkänns automatiskt");
    expect(columnFor(["intern", "auto-godkänn"])).toBe("Godkänns automatiskt");
    expect(columnFor(["designas", "auto-godkänn", "blockerad"])).toBe("Svara");
    const proposal = ["designas", "auto-godkänn"];
    expect(decideColumn(proposal, "Svara")).toEqual({ kind: "veto" });
    expect(decideColumn(proposal, "Godkänd")).toEqual({ kind: "approve" });
    expect(lageFor(proposal)).toBe("Agentens förslag gäller efter 24 h — svara i issuen eller flytta kortet till Svara för att säga emot");
    expect(proposalDue(proposal, hoursAgo(25), NOW)).toBe(true);
    expect(proposalDue(proposal, hoursAgo(2), NOW)).toBe(false);
    expect(proposalDue(proposal, undefined, NOW)).toBe(false);
    expect(proposalDue([...proposal, "blockerad"], hoursAgo(25), NOW)).toBe(false);
    expect(proposalDue(["undersökt", "auto-godkänn", "intern"], hoursAgo(25), NOW)).toBe(false);
  });

  it("Godkänns automatiskt: till Att besluta är ett veto, till Godkänd eller Avböjd ett beslut", () => {
    const auto = ["intern", "undersökt", "auto-godkänn"];
    expect(decideColumn(auto, "Godkänns automatiskt")).toEqual({ kind: "none" });
    expect(decideColumn(auto, "Att besluta")).toEqual({ kind: "veto" });
    expect(decideColumn(auto, "Godkänd")).toEqual({ kind: "approve" });
    expect(decideColumn(auto, "Avböjd")).toEqual({ kind: "decline" });
    expect(decideColumn(["undersökt"], "Godkänns automatiskt")).toEqual({ kind: "set", column: "Att besluta" });
  });

  it("Läge säger vad som händer nu, per kolumn", () => {
    expect(lageFor(["user-request"])).toBe("Loop 1 verifierar förfrågan");
    expect(lageFor(["undersökt"])).toBe("Väntar på ditt beslut");
    expect(lageFor(["undersökt", "rek-godkänn"])).toBe("Väntar på ditt beslut — rekommendation: godkänn");
    expect(lageFor(["undersökt", "auto-godkänn"])).toBe("Godkänns automatiskt efter 24 h om du inte flyttar den");
    expect(lageFor(["undersökt", "auto-godkänn"], { autoSince: "2026-11-19T20:30:00Z" })).toMatch(/^Godkänns automatiskt 20 nov\.? 21:30 om du inte flyttar den$/);
    expect(lageFor(["undersökt", "blockerad"])).toBe("Blockerad — läs senaste kommentaren och svara i issuen");
    expect(lageFor(["väntar-på-användaren"])).toBe("Loop 1 har frågat användaren i AVA och väntar på svar");
    expect(lageFor(["verifierad"])).toBe("Godkänd — loop 2 bryter ner den i arbetsorder");
    expect(lageFor(["nedbruten"])).toBe("Bryts ner i arbetsorder i kodrepot");
    expect(lageFor(["nedbruten"], { workOrders: { done: 1, total: 3, blocked: [] } })).toBe("Byggs: 1 av 3 arbetsorder klara");
    expect(lageFor(["nedbruten"], { workOrders: { done: 0, total: 0, blocked: [] } })).toBe("Bryts ner i arbetsorder i kodrepot");
    expect(lageFor(["nedbruten"], { workOrders: { done: 2, total: 2, blocked: [] } })).toBe("Byggd — kommer med nästa release");
    expect(lageFor(["dubblett"])).toBe("Dubblett — följer originalet");
    expect(lageFor(["levererad", "release:v0.7.42"])).toBe("Levererad i v0.7.42");
    expect(lageFor(["levererad"])).toBe("Levererad");
    expect(lageFor(["finns-redan"])).toBe("Fanns redan i AVA");
    expect(lageFor(["uppdelad"])).toBe("Uppdelad i egna förfrågningar");
  });

  it("en nedbruten förfrågan med en blockerad arbetsorder står kvar i Byggs och hänvisar till arbetsorderns kort (#1779)", () => {
    const ctx = { workOrders: { done: 0, total: 2, blocked: ["ava#1764"] } };
    expect(columnFor(["nedbruten"])).toBe("Byggs");
    expect(lageFor(["nedbruten"], ctx)).toBe("Byggs: 0 av 2 klara — ava#1764 väntar på dig (kortet står i Svara)");
  });

  it("en arbetsorders kort: Godkänd släpper, Avböjd stänger, Svara står, annat läggs tillbaka", () => {
    expect(decideWorkOrder("Svara")).toBe("none");
    expect(decideWorkOrder("Godkänd")).toBe("approve");
    expect(decideWorkOrder("Avböjd")).toBe("decline");
    expect(decideWorkOrder("Byggs")).toBe("set");
    expect(decideWorkOrder(null)).toBe("set");
  });

  it("rekommendationen läses ur etiketten", () => {
    expect(rekFor(["rek-avböj", "undersökt"])).toBe("avböj");
    expect(rekFor(["undersökt"])).toBeNull();
  });

  it("automatiskt godkännande: bara bugg eller internt, aldrig en användares förslag, aldrig när någon väntar", () => {
    const base = ["undersökt", "auto-godkänn"];
    expect(autoApprovable([...base, "intern"])).toBe(true);
    expect(autoApprovable([...base, "bugg", "user-request"])).toBe(true);
    expect(autoApprovable([...base, "intern", "förslag"])).toBe(true);
    expect(autoApprovable([...base, "förslag", "user-request"])).toBe(false);
    expect(autoApprovable([...base, "bugg", "förslag"])).toBe(false);
    expect(autoApprovable(["undersökt", "intern"])).toBe(false);
    expect(autoApprovable(["auto-godkänn", "intern"])).toBe(false);
    expect(autoApprovable([...base, "intern", "verifierad"])).toBe(false);
    expect(autoApprovable([...base, "intern", "blockerad"])).toBe(false);
    expect(autoApprovable([...base, "intern", "väntar-på-användaren"])).toBe(false);
  });

  it("vetofönstret: 24 h från när auto-godkänn sattes", () => {
    const labels = ["undersökt", "auto-godkänn", "intern"];
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(autoApproveDue(labels, new Date(now - AUTO_APPROVE_MS).toISOString(), now)).toBe(true);
    expect(autoApproveDue(labels, new Date(now - AUTO_APPROVE_MS + 60_000).toISOString(), now)).toBe(false);
    expect(autoApproveDue(labels, undefined, now)).toBe(false);
    expect(autoApproveDue(["undersökt", "auto-godkänn", "förslag"], new Date(0).toISOString(), now)).toBe(false);
  });

  it("prioriteten: saknas på tavlan → från etiketten; satt av Ulrik på tavlan → blir etiketten", () => {
    expect(decidePrio(["prio-hög"], "hög")).toEqual({ kind: "none" });
    expect(decidePrio([], null)).toEqual({ kind: "none" });
    expect(decidePrio(["prio-hög"], null)).toEqual({ kind: "set-board", prio: "hög" });
    expect(decidePrio(["prio-hög"], "okänd")).toEqual({ kind: "set-board", prio: "hög" });
    expect(decidePrio([], "okänd")).toEqual({ kind: "none" });
    expect(decidePrio(["prio-hög", "intern"], "låg")).toEqual({ kind: "set-label", prio: "låg", remove: ["prio-hög"] });
  });
});

/** En låtsastavla i minnet. */
function fakeBoard(items: BoardItem[]): BoardApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, url: "https://github.com/users/ulrik-s/projects/9",
    items: () => items,
    add: (contentId) => { calls.push(`add ${contentId}`); return `item-${contentId}`; },
    setColumn: (itemId, column) => { calls.push(`column ${itemId} ${column}`); },
    setPrio: (itemId, prio) => { calls.push(`prio ${itemId} ${prio}`); },
    setRek: (itemId, rek) => { calls.push(`rek ${itemId} ${rek}`); },
    setLage: (itemId, text) => { calls.push(`lage ${itemId} ${text}`); },
    archive: (itemId) => { calls.push(`archive ${itemId}`); },
  };
}
/** Ett låtsas-`gh`: händelseloggen svarar med `events` (per issue), allt annat med `{}`. */
function fakeGh(events: Record<number, Array<{ label: string; at: string }>> = {}): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: (args) => {
      const line = args.join(" ");
      calls.push(line);
      const n = /issues\/(\d+)\/events/.exec(line)?.[1];
      if (n === undefined) return "{}";
      const rows = (events[Number(n)] ?? []).map((e, i) => ({ id: i + 1, event: "labeled", created_at: e.at, label: { name: e.label }, actor: { login: "claude" }, performed_via_github_app: { slug: "claude" } }));
      return JSON.stringify([rows]);
    },
  };
}
const NOW = Date.parse("2026-11-20T12:00:00Z");
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const FB = "ulrik-s/ava-feedback";
const open = (number: number, labels: string[]): OpenItem => ({ number, title: "t", body: "", labels, isPr: false, nodeId: `I_${number}` });
const card = (number: number, column: string | null, prio: string | null = null, isOpen = true, extra: { rek?: string; lage?: string } = {}): BoardItem =>
  ({ itemId: `PVTI_${number}`, number, repo: FB, open: isOpen, column, prio, rek: extra.rek ?? null, lage: extra.lage ?? null });
/** Tavlans anrop utom Läge-texterna (de testas för sig). */
const withoutLage = (calls: readonly string[]): string[] => calls.filter((c) => !c.startsWith("lage "));

describe("synken", () => {
  const issues = [
    open(1, ["intern", "undersökt", "prio-hög"]), // ny på tavlan
    open(2, ["intern", "undersökt"]), // Ulrik flyttade till Godkänd
    open(3, ["intern"]), // Ulrik flyttade till Avböjd
    open(4, ["intern", "undersökt"]), // flyttad till Byggs: läggs tillbaka
    open(6, ["intern", "undersökt", "prio-hög"]), // Ulrik satte prio låg
  ];
  const cards = [card(2, "Godkänd"), card(3, "Avböjd"), card(4, "Byggs"), card(5, "Att besluta", null, false), card(6, "Att besluta", "låg")];

  it("lägger till nya, verkställer Ulriks flyttar, lägger tillbaka resten och arkiverar stängda", () => {
    const board = fakeBoard(cards);
    const gh = fakeGh();
    const r = syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: issues, enforce: true, log: () => {}, now: NOW });
    expect(r).toEqual({
      added: [1], approved: [2], declined: [3], reset: [4], archived: [5], vetoed: [], autoApproved: [],
      workOrders: { added: [], approved: [], declined: [], archived: [], prsApproved: [] },
    });
    expect(withoutLage(board.calls)).toEqual([
      "add I_1", "column item-I_1 Att besluta", "prio item-I_1 hög",
      "column PVTI_4 Att besluta",
      "archive PVTI_5",
    ]);
    expect(gh.calls).toEqual([
      `api repos/${FB}/issues/2/labels -f labels[]=verifierad`,
      `api repos/${FB}/issues/3/comments -f body=Avböjd av Ulrik på tavlan. Stängs utan att byggas.`,
      `api -X PATCH repos/${FB}/issues/3 -f state=closed -f state_reason=not_planned`,
      `api -X DELETE repos/${FB}/issues/6/labels/prio-h%C3%B6g`,
      `api repos/${FB}/issues/6/labels -f labels[]=prio-låg`,
    ]);
  });

  it("i rapportläge ändras inget; kort i andra repon och issues utan nod-id rörs inte", () => {
    const board = fakeBoard([...cards, { ...card(7, "Klar"), repo: "ulrik-s/ava" }]);
    const gh = fakeGh();
    const lines: string[] = [];
    const r = syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: [...issues, { number: 8, title: "t", body: "", labels: [], isPr: false }], enforce: false, log: (l) => lines.push(l), now: NOW });
    expect(r.approved).toEqual([2]);
    expect(board.calls).toEqual([]);
    expect(gh.calls).toEqual([]);
    expect(lines.some((l) => l.includes("#2: godkänd"))).toBe(true);
  });
});

describe("synken: rekommendation, veto och automatiskt godkännande", () => {
  const auto = (n: number, extra: string[] = []): OpenItem => open(n, ["intern", "undersökt", "auto-godkänn", "rek-godkänn", ...extra]);
  const sync = (issues: OpenItem[], cards: BoardItem[], events: Record<number, Array<{ label: string; at: string }>>, enforce = true) => {
    const board = fakeBoard(cards);
    const gh = fakeGh(events);
    const r = syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: issues, enforce, log: () => {}, now: NOW });
    return { r, board, gh };
  };

  it("nytt kort får rekommendationen; ett befintligt får den när den ändrats", () => {
    const { board } = sync([auto(1), open(2, ["undersökt", "rek-fråga"]), open(3, ["undersökt", "rek-avböj"])],
      [card(2, "Att besluta", null, true, { rek: "godkänn" }), card(3, "Att besluta", null, true, { rek: "avböj" })], {});
    expect(withoutLage(board.calls)).toEqual(["add I_1", "column item-I_1 Godkänns automatiskt", "rek item-I_1 godkänn", "rek PVTI_2 fråga"]);
  });

  it("efter 24 h utan veto sätts verifierad, med tavlans markör i kommentaren; före 24 h händer inget", () => {
    const { r, gh } = sync([auto(4), auto(5)], [card(4, "Godkänns automatiskt", null, true, { rek: "godkänn" }), card(5, "Godkänns automatiskt", null, true, { rek: "godkänn" })],
      { 4: [{ label: "auto-godkänn", at: hoursAgo(25) }], 5: [{ label: "auto-godkänn", at: hoursAgo(2) }] });
    expect(r.autoApproved).toEqual([4]);
    const writes = gh.calls.filter((c) => !c.includes("/events"));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain(`issues/4/comments -f body=${BOARD_MARKER}\nGodkänd automatiskt: 24 timmar`);
    expect(writes[1]).toBe(`api repos/${FB}/issues/4/labels -f labels[]=verifierad`);
  });

  const proposal = (n: number): OpenItem => open(n, ["intern", "designas", "auto-godkänn"]);

  it("agentens förslag efter 24 h: tavlans kommentar först (startar agenten), sedan bort med flaggan; före 24 h inget (#1872)", () => {
    const { gh } = sync([proposal(20), proposal(21)], [card(20, "Godkänns automatiskt"), card(21, "Godkänns automatiskt")],
      { 20: [{ label: "auto-godkänn", at: hoursAgo(25) }], 21: [{ label: "auto-godkänn", at: hoursAgo(2) }] });
    const writes = gh.calls.filter((c) => !c.includes("/events"));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain(`issues/20/comments -f body=${BOARD_MARKER}\nFörslaget gäller: 24 timmar utan veto`);
    expect(writes[1]).toBe(`api -X DELETE repos/${FB}/issues/20/labels/auto-godk%C3%A4nn`);
  });

  it("agentens förslag: till Godkänd gäller det direkt (ingen verifierad); till Svara blir det blockerat (#1872)", () => {
    const now = sync([proposal(22)], [card(22, "Godkänd")], { 22: [{ label: "auto-godkänn", at: hoursAgo(1) }] });
    expect(now.r.approved).toEqual([22]);
    expect(now.gh.calls.filter((c) => !c.includes("/events"))).toEqual([
      `api repos/${FB}/issues/22/comments -f body=${BOARD_MARKER}\nFörslaget gäller: Ulrik godkände det på tavlan. Gå på agentens förslag i den senaste frågan ovan.`,
      `api -X DELETE repos/${FB}/issues/22/labels/auto-godk%C3%A4nn`,
    ]);
    const vetoed = sync([proposal(23)], [card(23, "Svara")], { 23: [{ label: "auto-godkänn", at: hoursAgo(30) }] });
    expect(vetoed.r.vetoed).toEqual([23]);
    expect(vetoed.gh.calls.filter((c) => !c.includes("/events"))).toEqual([
      `api -X DELETE repos/${FB}/issues/23/labels/auto-godk%C3%A4nn`,
      `api repos/${FB}/issues/23/labels -f labels[]=blockerad`,
      `api repos/${FB}/issues/23/comments -f body=${BOARD_MARKER}\nVeto på tavlan: agentens förslag gäller inte. Vänta på Ulriks svar i issuen.`,
    ]);
    const dry = sync([proposal(24)], [card(24, "Godkänns automatiskt")], { 24: [{ label: "auto-godkänn", at: hoursAgo(30) }] }, false);
    expect(dry.gh.calls.filter((c) => !c.includes("/events"))).toEqual([]);
  });

  it("veto: Ulrik flyttade kortet till Att besluta → flaggan bort, inget godkännande", () => {
    const { r, gh } = sync([auto(6)], [card(6, "Att besluta", null, true, { rek: "godkänn" })], { 6: [{ label: "auto-godkänn", at: hoursAgo(30) }] });
    expect(r.vetoed).toEqual([6]);
    expect(r.autoApproved).toEqual([]);
    expect(gh.calls.filter((c) => !c.includes("/events"))).toEqual([
      `api -X DELETE repos/${FB}/issues/6/labels/auto-godk%C3%A4nn`,
      `api repos/${FB}/issues/6/comments -f body=${BOARD_MARKER}\nVeto på tavlan: godkänns inte automatiskt. Ulrik beslutar själv (Att besluta).`,
    ]);
  });

  it("Läge skrivs när texten ändrats, efter det synken just gjort; oförändrad text skrivs inte igen", () => {
    const issues = [
      open(10, ["intern", "undersökt"]), // Ulrik godkände: texten säger redan Godkänd
      auto(11), // veto: texten säger Att besluta
      open(12, ["intern", "nedbruten"]), // byggs, med framsteg
      open(13, ["intern", "undersökt"]), // texten stämmer redan
      auto(14), // godkänns automatiskt nu
      open(15, ["intern"]), // avböjd: ingen text, den stängs
    ];
    const cards = [
      card(10, "Godkänd"), card(11, "Att besluta", null, true, { rek: "godkänn" }), card(12, "Byggs"),
      card(13, "Att besluta", null, true, { lage: "Väntar på ditt beslut" }), card(14, "Godkänns automatiskt", null, true, { rek: "godkänn" }), card(15, "Avböjd"),
    ];
    const board = fakeBoard(cards);
    const gh = fakeGh({ 11: [{ label: "auto-godkänn", at: hoursAgo(30) }], 14: [{ label: "auto-godkänn", at: hoursAgo(25) }] });
    syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: issues, enforce: true, log: () => {}, now: NOW, workOrders: new Map([[12, { done: 1, total: 2, blocked: [] }]]) });
    expect(board.calls.filter((c) => c.startsWith("lage "))).toEqual([
      "lage PVTI_10 Godkänd — loop 2 bryter ner den i arbetsorder",
      "lage PVTI_11 Väntar på ditt beslut — rekommendation: godkänn",
      "lage PVTI_12 Byggs: 1 av 2 arbetsorder klara",
      "lage PVTI_14 Godkänd — loop 2 bryter ner den i arbetsorder",
    ]);
  });

  it("nya kort får Läge direkt", () => {
    const board = fakeBoard([]);
    syncBoard({ board, intake: gitHub(FB, fakeGh().run), intakeRepo: FB, open: [open(20, ["intern", "nedbruten"])], enforce: true, log: () => {}, now: NOW, workOrders: new Map([[20, { done: 0, total: 1, blocked: [] }]]) });
    expect(board.calls).toContain("lage item-I_20 Byggs: 0 av 1 arbetsorder klara");
  });

  it("en användares förslag godkänns aldrig automatiskt, och i rapportläge skrivs inget", () => {
    const suggestion = open(7, ["user-request", "förslag", "undersökt", "auto-godkänn"]);
    expect(sync([suggestion], [card(7, "Godkänns automatiskt")], { 7: [{ label: "auto-godkänn", at: hoursAgo(48) }] }).r.autoApproved).toEqual([]);
    const dry = sync([auto(8)], [card(8, "Godkänns automatiskt", null, true, { rek: "godkänn" })], { 8: [{ label: "auto-godkänn", at: hoursAgo(48) }] }, false);
    expect(dry.r.autoApproved).toEqual([8]);
    expect(dry.gh.calls.filter((c) => !c.includes("/events"))).toEqual([]);
  });
});

describe("blockerade arbetsordrar som egna kort (#1779)", () => {
  const AVA = "ulrik-s/ava";
  const wo = (n: number, labels: string[]): OpenItem => ({ ...open(n, labels), body: "Intag: ava-feedback#9" });
  const pr = (n: number, closes: number, labels: string[]): OpenItem => ({ number: n, title: "p", body: `Closes #${closes}`, labels, isPr: true });
  const woCard = (n: number, column: string | null, lage: string | null = WORK_ORDER_LAGE): BoardItem => ({ ...card(n, column, null, true, lage === null ? {} : { lage }), repo: AVA });
  const sync = (codeOpen: OpenItem[], cards: BoardItem[], enforce = true) => {
    const board = fakeBoard(cards);
    const gh = fakeGh();
    const code: CodeSide = { repo: AVA, gh: gitHub(AVA, gh.run), open: codeOpen, states: ["att-granska", "granskad", "pågår"] };
    const r = syncBoard({ board, intake: gitHub(FB, fakeGh().run), intakeRepo: FB, open: [], enforce, log: () => {}, now: NOW, code });
    return { r, board, gh };
  };

  it("en blockerad arbetsorder läggs på tavlan i Svara med instruktionen", () => {
    const { r, board } = sync([wo(1764, ["agent-task", "granskad", "blockerad"]), wo(1765, ["agent-task", "granskad"])], []);
    expect(r.workOrders.added).toEqual([1764]);
    expect(board.calls).toEqual(["add I_1764", "column item-I_1764 Svara", `lage item-I_1764 ${WORK_ORDER_LAGE}`]);
  });

  it("Godkänd: blockerad bort, människa-godkänd på, och tillståndet sätts igen så att agenten startar", () => {
    const { r, gh } = sync([wo(1764, ["agent-task", "granskad", "blockerad"])], [woCard(1764, "Godkänd")]);
    expect(r.workOrders.approved).toEqual([1764]);
    expect(gh.calls[0]).toBe(`api -X DELETE repos/${AVA}/issues/1764/labels/blockerad`);
    expect(gh.calls[1]).toBe(`api repos/${AVA}/issues/1764/labels -f labels[]=${HUMAN_APPROVED}`);
    expect(gh.calls[2]).toContain(`issues/1764/comments -f body=${BOARD_MARKER}`);
    expect(gh.calls.slice(3)).toEqual([`api -X DELETE repos/${AVA}/issues/1764/labels/granskad`, `api repos/${AVA}/issues/1764/labels -f labels[]=granskad`]);
  });

  it("Avböjd stänger arbetsordern; en flytt någon annanstans läggs tillbaka; en gammal Läge-text skrivs om", () => {
    const blocked = (n: number) => wo(n, ["agent-task", "att-granska", "blockerad"]);
    const { r, gh, board } = sync([blocked(1), blocked(2), blocked(3)], [woCard(1, "Avböjd"), woCard(2, "Byggs"), woCard(3, "Svara", "gammal")]);
    expect(r.workOrders.declined).toEqual([1]);
    expect(gh.calls).toEqual([
      `api repos/${AVA}/issues/1/comments -f body=Avböjd av Ulrik på tavlan. Arbetsordern stängs utan att byggas.`,
      `api -X PATCH repos/${AVA}/issues/1 -f state=closed -f state_reason=not_planned`,
    ]);
    expect(board.calls).toEqual(["column PVTI_2 Svara", `lage PVTI_3 ${WORK_ORDER_LAGE}`]);
  });

  it("en arbetsorder som inte längre är blockerad (eller är stängd) arkiveras; utan tillstånd sätts inget igen", () => {
    const { r, board, gh } = sync([wo(5, ["agent-task", "granskad"]), wo(6, ["agent-task", "blockerad"])], [woCard(5, "Svara"), { ...woCard(7, "Svara"), open: false }, woCard(6, "Godkänd")]);
    expect(r.workOrders.archived).toEqual([5, 7]);
    expect(board.calls).toEqual(["archive PVTI_5", "archive PVTI_7"]);
    expect(gh.calls.filter((c) => c.includes("labels/granskad") || c.includes("labels[]=granskad"))).toEqual([]);
  });

  it("en agent-PR för en arbetsorder Ulrik godkänt får människa-godkänd; andra rörs inte", () => {
    const { r, gh } = sync([
      wo(10, ["agent-task", "pågår", HUMAN_APPROVED]), wo(11, ["agent-task", "pågår"]),
      pr(20, 10, ["agent-pr"]), pr(21, 11, ["agent-pr"]), pr(22, 10, ["agent-pr", HUMAN_APPROVED]), pr(23, 10, []),
      { ...pr(24, 0, ["agent-pr"]), body: "ingen stängning" },
    ], []);
    expect(r.workOrders.prsApproved).toEqual([20]);
    expect(gh.calls).toEqual([`api repos/${AVA}/issues/20/labels -f labels[]=${HUMAN_APPROVED}`]);
  });

  it("i rapportläge skrivs inget", () => {
    const { r, board, gh } = sync([wo(1, ["agent-task", "granskad", "blockerad"]), wo(2, ["agent-task", "granskad", "blockerad"])], [woCard(2, "Godkänd")], false);
    expect(r.workOrders).toMatchObject({ added: [1], approved: [2] });
    expect(board.calls).toEqual([]);
    expect(gh.calls).toEqual([]);
  });
});

describe("arbetsordrarna per förfrågan", () => {
  it("läser Intag-raden, bara på egen rad och för rätt intag", () => {
    expect(intakeRefOf("…\nIntag: ava-feedback#34\n", FB)).toBe(34);
    expect(intakeRefOf("se Intag: ava-feedback#34 i texten", FB)).toBeNull();
    expect(intakeRefOf("Intag: annat#34", FB)).toBeNull();
  });

  it("räknar klara (stängda som completed) av alla, och de öppna som väntar på Ulrik, med en sökning", () => {
    const calls: string[] = [];
    const page = { items: [
      { number: 1, body: "Intag: ava-feedback#34", state: "closed", state_reason: "completed" },
      { number: 2, body: "Intag: ava-feedback#34", state: "open", state_reason: null, labels: [{ name: "blockerad" }] },
      { number: 3, body: "Intag: ava-feedback#35", state: "closed", state_reason: "not_planned", labels: [{ name: "blockerad" }] },
      { number: 4, body: null, state: "open" },
    ] };
    const run: GhRunner = (args) => { calls.push(args.join(" ")); return JSON.stringify([page]); };
    const wo = gitHub("ulrik-s/ava", run).workOrders(FB);
    expect([...wo]).toEqual([[34, { done: 1, total: 2, blocked: ["ava#2"] }], [35, { done: 0, total: 1, blocked: [] }]]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('q=repo:ulrik-s/ava is:issue "Intag: ava-feedback" in:body');
  });
});

/** Ett låtsas-`gh` för GraphQL: svarar efter vad frågan innehåller och minns anropen. */
function fakeGraphql(opts: { projectExists: boolean; statusOk: boolean; prio: boolean; board: boolean; prioNames?: string[] }): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const status = (ok: boolean) => ({ id: "F_status", name: "Status", options: (ok ? COLUMNS.map((c) => c.name) : ["Todo", "Done"]).map((n) => ({ id: `O_${n}`, name: n })) });
  const prio = { id: "F_prio", name: "Prio", options: (opts.prioNames ?? ["hög", "medel", "låg"]).map((n) => ({ id: `O_${n}`, name: n })) };
  const rek = { id: "F_rek", name: "Rekommendation", options: ["godkänn", "avböj", "fråga"].map((n) => ({ id: `O_${n}`, name: n })) };
  const lage = { id: "F_lage", name: "Läge", dataType: "TEXT" };
  const title = { id: "F_title", name: "Title", dataType: "TITLE" };
  const project = { id: "P_1", number: 9, title: "AVA – flödet", url: "https://github.com/users/ulrik-s/projects/9" };
  const item = (n: number, state: string, status: string) =>
    ({ id: `PVTI_${n}`, content: { number: n, state, repository: { nameWithOwner: FB } }, fieldValues: { nodes: [{ name: status, field: { name: "Status" } }, { text: `läge ${n}`, field: { name: "Läge" } }, {}] } });
  const answer = (q: string, args: string): unknown => {
    if (q.includes("projectsV2(first:50)")) return { user: { id: "U_1", projectsV2: { nodes: opts.projectExists ? [project] : [] } } };
    if (q.includes("createProjectV2(")) return { createProjectV2: { projectV2: project } };
    if (q.includes("fields(first:30)")) return { node: { fields: { nodes: [status(opts.statusOk), {}, title, ...(opts.prio ? [prio, rek, lage] : [])] }, views: { nodes: [{ layout: opts.board ? "BOARD_LAYOUT" : "TABLE_LAYOUT" }] } } };
    if (q.includes("updateProjectV2Field(")) return { updateProjectV2Field: { projectV2Field: status(true) } };
    if (q.includes("createProjectV2Field(")) {
      const made = q.includes("dataType:TEXT") ? { id: "F_lage" } : q.includes('name:"Prio"') ? prio : rek;
      return { createProjectV2Field: { projectV2Field: made } };
    }
    if (q.includes("items(first:100")) {
      return args.includes("after=") ? { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [item(2, "CLOSED", "Klar"), { id: "PVTI_draft", content: null, fieldValues: { nodes: [] } }] } } }
        : { node: { items: { pageInfo: { hasNextPage: true, endCursor: "C1" }, nodes: [item(1, "OPEN", "Ny")] } } };
    }
    if (q.includes("addProjectV2ItemById(")) return { addProjectV2ItemById: { item: { id: "PVTI_new" } } };
    return {};
  };
  const run: GhRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    const q = args.find((a) => a.startsWith("query="))?.slice("query=".length) ?? "";
    return JSON.stringify({ data: answer(q, line) });
  };
  return { run, calls };
}

describe("projekttavlan i GitHub", () => {
  it("skapar projektet, sätter kolumnerna, skapar Prio-fältet och tavelvyn när de saknas", () => {
    const gh = fakeGraphql({ projectExists: false, statusOk: false, prio: false, board: false });
    const logs: string[] = [];
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", (l) => logs.push(l));
    expect(board.url).toBe("https://github.com/users/ulrik-s/projects/9");
    expect(logs).toEqual(['skapar projektet "AVA – flödet"']);
    const joined = gh.calls.join("\n");
    expect(joined).toContain("createProjectV2(input:{ownerId:$owner");
    expect(joined).toContain('updateProjectV2Field(input:{fieldId:$id,singleSelectOptions:[{name:"Ny",color:GRAY');
    expect(joined).toContain('createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"Prio"');
    expect(joined).toContain('createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:"Rekommendation"');
    expect(joined).toContain('createProjectV2Field(input:{projectId:$p,dataType:TEXT,name:"Läge"');
    expect(joined).toContain("createProjectV2View(input:{projectId:$p,name:\"Tavla\",layout:BOARD_LAYOUT})");
  });

  it("ett befintligt projekt med rätt fält ändras inte; kort läses över flera sidor, utkast hoppas över", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(gh.calls.some((c) => /createProjectV2\(|updateProjectV2Field|createProjectV2Field|createProjectV2View/.test(c))).toBe(false);
    expect(board.items()).toEqual([
      { itemId: "PVTI_1", number: 1, repo: FB, open: true, column: "Ny", prio: null, rek: null, lage: "läge 1" },
      { itemId: "PVTI_2", number: 2, repo: FB, open: false, column: "Klar", prio: null, rek: null, lage: "läge 2" },
    ]);
    expect(gh.calls.some((c) => c.includes("after=C1"))).toBe(true);
  });

  it("lägger till, sätter kolumn och prio med valens id, och arkiverar", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(board.add("I_5")).toBe("PVTI_new");
    board.setColumn("PVTI_new", "Godkänd");
    board.setPrio("PVTI_new", "hög");
    board.setRek("PVTI_new", "fråga");
    board.setLage("PVTI_new", "Byggs: 1 av 2 arbetsorder klara");
    board.archive("PVTI_new");
    const joined = gh.calls.join("\n");
    expect(joined).toContain("c=I_5");
    expect(joined).toContain("f=F_status -f o=O_Godkänd");
    expect(joined).toContain("f=F_prio -f o=O_hög");
    expect(joined).toContain("f=F_rek -f o=O_fråga");
    expect(joined).toContain("f=F_lage -f t=Byggs: 1 av 2 arbetsorder klara");
    expect(joined).toContain("archiveProjectV2Item(");
  });

  it("ett val som saknas i fältet är ett fel, inte ett tyst hopp", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true, prioNames: ["hög", "medel"] });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(() => { board.setPrio("PVTI_new", "låg"); }).toThrow(/saknar valet låg/);
  });
});
