/**
 * Projekttavlan: kort följer etiketterna, och Ulriks flyttar till Godkänd och
 * Avböjd blir beslut (verifierad, eller stängd). Prioriteten kan ändras på
 * tavlan. Synken läser av tavlan, eftersom GitHub inte kan starta en workflow
 * när ett kort flyttas.
 */
import { describe, expect, it } from "vitest-compat";
import { COLUMN_LABELS, COLUMNS, columnFor, decideColumn, decidePrio } from "../../tooling/scripts/flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "../../tooling/scripts/flow/board-github";
import { gitHub, type GhRunner, type OpenItem } from "../../tooling/scripts/flow/github";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { syncBoard } from "../../tooling/scripts/flow-board";

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
    archive: (itemId) => { calls.push(`archive ${itemId}`); },
  };
}
function fakeGh(): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  return { calls, run: (args) => { calls.push(args.join(" ")); return "{}"; } };
}
const FB = "ulrik-s/ava-feedback";
const open = (number: number, labels: string[]): OpenItem => ({ number, title: "t", body: "", labels, isPr: false, nodeId: `I_${number}` });
const card = (number: number, column: string | null, prio: string | null = null, isOpen = true): BoardItem =>
  ({ itemId: `PVTI_${number}`, number, repo: FB, open: isOpen, column, prio });

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
    const r = syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: issues, enforce: true, log: () => {} });
    expect(r).toEqual({ added: [1], approved: [2], declined: [3], reset: [4], archived: [5] });
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
    const r = syncBoard({ board, intake: gitHub(FB, gh.run), intakeRepo: FB, open: [...issues, { number: 8, title: "t", body: "", labels: [], isPr: false }], enforce: false, log: (l) => lines.push(l) });
    expect(r.approved).toEqual([2]);
    expect(board.calls).toEqual([]);
    expect(gh.calls).toEqual([]);
    expect(lines.some((l) => l.includes("#2: godkänd"))).toBe(true);
  });
});

/** Ett låtsas-`gh` för GraphQL: svarar efter vad frågan innehåller och minns anropen. */
function fakeGraphql(opts: { projectExists: boolean; statusOk: boolean; prio: boolean; board: boolean; prioNames?: string[] }): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  const status = (ok: boolean) => ({ id: "F_status", name: "Status", options: (ok ? COLUMNS.map((c) => c.name) : ["Todo", "Done"]).map((n) => ({ id: `O_${n}`, name: n })) });
  const prio = { id: "F_prio", name: "Prio", options: (opts.prioNames ?? ["hög", "medel", "låg"]).map((n) => ({ id: `O_${n}`, name: n })) };
  const project = { id: "P_1", number: 9, title: "AVA – flödet", url: "https://github.com/users/ulrik-s/projects/9" };
  const item = (n: number, state: string, status: string) =>
    ({ id: `PVTI_${n}`, content: { number: n, state, repository: { nameWithOwner: FB } }, fieldValues: { nodes: [{ name: status, field: { name: "Status" } }, {}] } });
  const answer = (q: string, args: string): unknown => {
    if (q.includes("projectsV2(first:50)")) return { user: { id: "U_1", projectsV2: { nodes: opts.projectExists ? [project] : [] } } };
    if (q.includes("createProjectV2(")) return { createProjectV2: { projectV2: project } };
    if (q.includes("fields(first:30)")) return { node: { fields: { nodes: [status(opts.statusOk), {}, ...(opts.prio ? [prio] : [])] }, views: { nodes: [{ layout: opts.board ? "BOARD_LAYOUT" : "TABLE_LAYOUT" }] } } };
    if (q.includes("updateProjectV2Field(")) return { updateProjectV2Field: { projectV2Field: status(true) } };
    if (q.includes("createProjectV2Field(")) return { createProjectV2Field: { projectV2Field: prio } };
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
    expect(joined).toContain("createProjectV2View(input:{projectId:$p,name:\"Tavla\",layout:BOARD_LAYOUT})");
  });

  it("ett befintligt projekt med rätt fält ändras inte; kort läses över flera sidor, utkast hoppas över", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(gh.calls.some((c) => /createProjectV2\(|updateProjectV2Field|createProjectV2Field|createProjectV2View/.test(c))).toBe(false);
    expect(board.items()).toEqual([
      { itemId: "PVTI_1", number: 1, repo: FB, open: true, column: "Ny", prio: null },
      { itemId: "PVTI_2", number: 2, repo: FB, open: false, column: "Klar", prio: null },
    ]);
    expect(gh.calls.some((c) => c.includes("after=C1"))).toBe(true);
  });

  it("lägger till, sätter kolumn och prio med valens id, och arkiverar", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(board.add("I_5")).toBe("PVTI_new");
    board.setColumn("PVTI_new", "Godkänd");
    board.setPrio("PVTI_new", "hög");
    board.archive("PVTI_new");
    const joined = gh.calls.join("\n");
    expect(joined).toContain("c=I_5");
    expect(joined).toContain("f=F_status -f o=O_Godkänd");
    expect(joined).toContain("f=F_prio -f o=O_hög");
    expect(joined).toContain("archiveProjectV2Item(");
  });

  it("ett val som saknas i fältet är ett fel, inte ett tyst hopp", () => {
    const gh = fakeGraphql({ projectExists: true, statusOk: true, prio: true, board: true, prioNames: ["hög", "medel"] });
    const board = projectBoard(gh.run, "ulrik-s", "AVA – flödet", () => {});
    expect(() => { board.setPrio("PVTI_new", "låg"); }).toThrow(/saknar valet låg/);
  });
});
