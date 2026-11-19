/**
 * Projekttavlan: kort följer etiketterna, och Ulriks flyttar till Godkänd och
 * Avböjd blir beslut (verifierad, eller stängd). Prioriteten kan ändras på
 * tavlan. Synken läser av tavlan, eftersom GitHub inte kan starta en workflow
 * när ett kort flyttas.
 */
import { describe, expect, it } from "vitest-compat";
import { AUTO_APPROVE_MS, autoApprovable, autoApproveDue, COLUMN_LABELS, COLUMNS, columnFor, decideColumn, decidePrio, rekFor } from "../../tooling/scripts/flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "../../tooling/scripts/flow/board-github";
import { gitHub, type GhRunner, type OpenItem } from "../../tooling/scripts/flow/github";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { BOARD_MARKER, syncBoard } from "../../tooling/scripts/flow-board";

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

  it("Godkänns automatiskt: till Att besluta är ett veto, till Godkänd eller Avböjd ett beslut", () => {
    const auto = ["intern", "undersökt", "auto-godkänn"];
    expect(decideColumn(auto, "Godkänns automatiskt")).toEqual({ kind: "none" });
    expect(decideColumn(auto, "Att besluta")).toEqual({ kind: "veto" });
    expect(decideColumn(auto, "Godkänd")).toEqual({ kind: "approve" });
    expect(decideColumn(auto, "Avböjd")).toEqual({ kind: "decline" });
    expect(decideColumn(["undersökt"], "Godkänns automatiskt")).toEqual({ kind: "set", column: "Att besluta" });
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
const card = (number: number, column: string | null, prio: string | null = null, isOpen = true, rek: string | null = null): BoardItem =>
  ({ itemId: `PVTI_${number}`, number, repo: FB, open: isOpen, column, prio, rek });

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
    expect(r).toEqual({ added: [1], approved: [2], declined: [3], reset: [4], archived: [5], vetoed: [], autoApproved: [] });
    expect(board.calls).toEqual([
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
      [card(2, "Att besluta", null, true, "godkänn"), card(3, "Att besluta", null, true, "avböj")], {});
    expect(board.calls).toEqual(["add I_1", "column item-I_1 Godkänns automatiskt", "rek item-I_1 godkänn", "rek PVTI_2 fråga"]);
  });

  it("efter 24 h utan veto sätts verifierad, med tavlans markör i kommentaren; före 24 h händer inget", () => {
    const { r, gh } = sync([auto(4), auto(5)], [card(4, "Godkänns automatiskt", null, true, "godkänn"), card(5, "Godkänns automatiskt", null, true, "godkänn")],
      { 4: [{ label: "auto-godkänn", at: hoursAgo(25) }], 5: [{ label: "auto-godkänn", at: hoursAgo(2) }] });
    expect(r.autoApproved).toEqual([4]);
    const writes = gh.calls.filter((c) => !c.includes("/events"));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain(`issues/4/comments -f body=${BOARD_MARKER}\nGodkänd automatiskt: 24 timmar`);
    expect(writes[1]).toBe(`api repos/${FB}/issues/4/labels -f labels[]=verifierad`);
  });

  it("veto: Ulrik flyttade kortet till Att besluta → flaggan bort, inget godkännande", () => {
    const { r, gh } = sync([auto(6)], [card(6, "Att besluta", null, true, "godkänn")], { 6: [{ label: "auto-godkänn", at: hoursAgo(30) }] });
    expect(r.vetoed).toEqual([6]);
    expect(r.autoApproved).toEqual([]);
    expect(gh.calls).toEqual([
      `api -X DELETE repos/${FB}/issues/6/labels/auto-godk%C3%A4nn`,
      `api repos/${FB}/issues/6/comments -f body=${BOARD_MARKER}\nVeto på tavlan: godkänns inte automatiskt. Ulrik beslutar själv (Att besluta).`,
    ]);
  });

  it("en användares förslag godkänns aldrig automatiskt, och i rapportläge skrivs inget", () => {
    const suggestion = open(7, ["user-request", "förslag", "undersökt", "auto-godkänn"]);
    expect(sync([suggestion], [card(7, "Godkänns automatiskt")], { 7: [{ label: "auto-godkänn", at: hoursAgo(48) }] }).r.autoApproved).toEqual([]);
    const dry = sync([auto(8)], [card(8, "Godkänns automatiskt", null, true, "godkänn")], { 8: [{ label: "auto-godkänn", at: hoursAgo(48) }] }, false);
    expect(dry.r.autoApproved).toEqual([8]);
    expect(dry.gh.calls.filter((c) => !c.includes("/events"))).toEqual([]);
  });
});

/** Ett låtsas-`gh` för GraphQL: svarar efter vad frågan innehåller och minns anropen. */
function fakeGraphql(opts: { projectExists: boolean; statusOk: boolean; prio: boolean; board: boolean; prioNames?: string[] }): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const status = (ok: boolean) => ({ id: "F_status", name: "Status", options: (ok ? COLUMNS.map((c) => c.name) : ["Todo", "Done"]).map((n) => ({ id: `O_${n}`, name: n })) });
  const prio = { id: "F_prio", name: "Prio", options: (opts.prioNames ?? ["hög", "medel", "låg"]).map((n) => ({ id: `O_${n}`, name: n })) };
  const rek = { id: "F_rek", name: "Rekommendation", options: ["godkänn", "avböj", "fråga"].map((n) => ({ id: `O_${n}`, name: n })) };
  const project = { id: "P_1", number: 9, title: "AVA – flödet", url: "https://github.com/users/ulrik-s/projects/9" };
  const item = (n: number, state: string, status: string) =>
    ({ id: `PVTI_${n}`, content: { number: n, state, repository: { nameWithOwner: FB } }, fieldValues: { nodes: [{ name: status, field: { name: "Status" } }, {}] } });
  const answer = (q: string, args: string): unknown => {
    if (q.includes("projectsV2(first:50)")) return { user: { id: "U_1", projectsV2: { nodes: opts.projectExists ? [project] : [] } } };
    if (q.includes("createProjectV2(")) return { createProjectV2: { projectV2: project } };
    if (q.includes("fields(first:30)")) return { node: { fields: { nodes: [status(opts.statusOk), {}, ...(opts.prio ? [prio, rek] : [])] }, views: { nodes: [{ layout: opts.board ? "BOARD_LAYOUT" : "TABLE_LAYOUT" }] } } };
    if (q.includes("updateProjectV2Field(")) return { updateProjectV2Field: { projectV2Field: status(true) } };
    if (q.includes("createProjectV2Field(")) return { createProjectV2Field: { projectV2Field: q.includes('name:"Prio"') ? prio : rek } };
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
    expect(joined).toContain("createProjectV2View(input:{projectId:$p,name:\"Tavla\",layout:BOARD_LAYOUT})");
  });

  it("ett befintligt projekt med rätt fält ändras inte; kort läses över flera sidor, utkast hoppas över", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(gh.calls.some((c) => /createProjectV2\(|updateProjectV2Field|createProjectV2Field|createProjectV2View/.test(c))).toBe(false);
    expect(board.items()).toEqual([
      { itemId: "PVTI_1", number: 1, repo: FB, open: true, column: "Ny", prio: null, rek: null },
      { itemId: "PVTI_2", number: 2, repo: FB, open: false, column: "Klar", prio: null, rek: null },
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
    board.archive("PVTI_new");
    const joined = gh.calls.join("\n");
    expect(joined).toContain("c=I_5");
    expect(joined).toContain("f=F_status -f o=O_Godkänd");
    expect(joined).toContain("f=F_prio -f o=O_hög");
    expect(joined).toContain("f=F_rek -f o=O_fråga");
    expect(joined).toContain("archiveProjectV2Item(");
  });

  it("ett val som saknas i fältet är ett fel, inte ett tyst hopp", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true, prioNames: ["hög", "medel"] });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(() => { board.setPrio("PVTI_new", "låg"); }).toThrow(/saknar valet låg/);
  });
});
