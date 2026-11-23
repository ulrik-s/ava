#!/usr/bin/env bun
/**
 * Synkar projekttavlan "AVA – flödet" med inkorgen (se `flow/board.ts`).
 * Körs var 5:e minut av `.github/workflows/tavla.yml`, eftersom GitHub inte kan starta en
 * workflow när ett kort flyttas.
 *
 *   FLOW_BOARD_TOKEN=… FLOW_GUARD_MODE=enforce bun tooling/scripts/flow-board.ts
 *
 * Utan FLOW_GUARD_MODE=enforce loggas bara vad som skulle göras.
 */
import {
  AUTO_APPROVE_MS, AUTO_LABEL, autoApprovable, autoApproveDue, type Column, type ColumnAction, columnFor, decideColumn, decidePrio,
  decideWorkOrder, isProposal, lageFor, proposalDue, rekFor, WORK_ORDER_LAGE, type WorkOrderMove,
} from "./flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "./flow/board-github";
import { type GitHub, gitHub, type OpenItem, runGhWithToken, type WorkOrderProgress, type WorkOrders } from "./flow/github";
import { loadFlow, stateLabels } from "./flow/load";
import { closesIssue } from "./flow/watchdog";

/** Projektets namn i GitHub. */
export const BOARD_TITLE = "AVA – flödet";

/**
 * Det synken behöver. `now` styr vetofönstret för det automatiska godkännandet,
 * `workOrders` (arbetsordrarnas framsteg per förfrågan) Läge-texten för det som byggs.
 */
export interface SyncDeps {
  board: BoardApi; intake: GitHub; intakeRepo: string; open: readonly OpenItem[]; enforce: boolean; log: (l: string) => void; now: number;
  workOrders?: WorkOrderProgress;
  /** Kodrepot (#1779): blockerade arbetsordrar blir kort, och Ulriks godkännande följer med till PR:en. */
  code?: CodeSide;
}

/** Kodrepot för arbetsordrarnas kort: dess öppna issues och PR:er, och arbetsordrarnas tillståndsetiketter. */
export interface CodeSide { repo: string; gh: GitHub; open: readonly OpenItem[]; states: readonly string[] }

/** Ulriks godkännande av skyddade sökvägar — på arbetsordern (tavlan) och dess PR (Agentvakten). */
export const HUMAN_APPROVED = "människa-godkänd";

/** Vad en synk gjorde. */
export interface SyncResult {
  added: number[]; approved: number[]; declined: number[]; reset: number[]; archived: number[]; vetoed: number[]; autoApproved: number[];
  /** Arbetsordrarnas kort (#1779) och de PR:er som fick Ulriks godkännande. */
  workOrders: { added: number[]; approved: number[]; declined: number[]; archived: number[]; prsApproved: number[] };
}

const APPROVE_WORK_ORDER = `<!-- tavlan -->\nGodkänd av Ulrik på tavlan: \`blockerad\` borttagen och arbetsordern släppt. Dess PR får röra skyddade sökvägar — tavlans synk sätter \`${HUMAN_APPROVED}\` på den.`;
const DECLINE_WORK_ORDER = "Avböjd av Ulrik på tavlan. Arbetsordern stängs utan att byggas.";

/**
 * Markören först i synkens kommentarer: de är tavlans, inte Ulriks egna ord,
 * fast de skrivs med hans token (agenterna läser Ulriks kommentarer som beslut).
 */
export const BOARD_MARKER = "<!-- tavlan -->";

const AUTO_COMMENT = `${BOARD_MARKER}\nGodkänd automatiskt: ${AUTO_APPROVE_MS / 3_600_000} timmar i "Godkänns automatiskt" utan veto. ` +
  "Loop 1 bedömde den som en liten bekräftad bugg eller ett internt verktyg, inom ADR:erna och utan risk (pengar, inloggning, migration, klientdata). " +
  "Var det fel: ta bort `verifierad` innan loop 2 hunnit bryta ner den, eller stäng den.";
const VETO_COMMENT = `${BOARD_MARKER}\nVeto på tavlan: godkänns inte automatiskt. Ulrik beslutar själv (Att besluta).`;
/*
 * Agentens förslag (#1872). Kommentaren skrivs medan `auto-godkänn` sitter kvar,
 * så att flödesvakten startar tillståndets agent (Ulriks token, regel 7).
 */
const PROPOSAL_COMMENT = `${BOARD_MARKER}\nFörslaget gäller: ${AUTO_APPROVE_MS / 3_600_000} timmar utan veto från Ulrik. ` +
  "Gå på agentens förslag i den senaste frågan ovan, om inte Ulrik själv svarat annat där.";
const PROPOSAL_NOW_COMMENT = `${BOARD_MARKER}\nFörslaget gäller: Ulrik godkände det på tavlan. Gå på agentens förslag i den senaste frågan ovan.`;
const PROPOSAL_VETO_COMMENT = `${BOARD_MARKER}\nVeto på tavlan: agentens förslag gäller inte. Vänta på Ulriks svar i issuen.`;

function addMissing(d: SyncDeps, onBoard: ReadonlySet<number>, result: SyncResult): void {
  for (const i of d.open) {
    if (onBoard.has(i.number) || i.nodeId === undefined) continue;
    result.added.push(i.number);
    const column = columnFor(i.labels);
    d.log(`#${i.number}: läggs på tavlan i ${column}`);
    if (!d.enforce) continue;
    const itemId = d.board.add(i.nodeId);
    d.board.setColumn(itemId, column);
    const prio = decidePrio(i.labels, null);
    if (prio.kind === "set-board") d.board.setPrio(itemId, prio.prio);
    const rek = rekFor(i.labels);
    if (rek !== null) d.board.setRek(itemId, rek);
    d.board.setLage(itemId, lageFor(i.labels, workOrdersOf(d, i.number)));
  }
}

/** Verkställer kortets kolumn. Ger beslutet, så att det automatiska godkännandet vet om Ulrik flyttat kortet. */
function applyColumn(d: SyncDeps, item: BoardItem, labels: readonly string[], result: SyncResult): ColumnAction {
  const action = decideColumn(labels, item.column);
  if (action.kind === "approve") {
    approve(d, item, labels, result);
  } else if (action.kind === "decline") {
    result.declined.push(item.number);
    d.log(`#${item.number}: avböjd på tavlan → stängs`);
    if (d.enforce) {
      d.intake.comment(item.number, "Avböjd av Ulrik på tavlan. Stängs utan att byggas.");
      d.intake.closeIssue(item.number, "not_planned");
    }
  } else if (action.kind === "veto") {
    veto(d, item, labels, result);
  } else if (action.kind === "set") {
    setColumn(d, item, action.column, result);
  }
  return action;
}

/** Godkänt på tavlan: ett agentförslag gäller direkt, annars blir förfrågan verifierad. */
function approve(d: SyncDeps, item: BoardItem, labels: readonly string[], result: SyncResult): void {
  result.approved.push(item.number);
  if (isProposal(labels)) { acceptProposal(d, item.number, PROPOSAL_NOW_COMMENT); return; }
  d.log(`#${item.number}: godkänd på tavlan → verifierad`);
  if (d.enforce) d.intake.addLabel(item.number, "verifierad");
}

/** Agentens förslag gäller: kommentaren först (den startar agenten), sedan bort med flaggan. */
function acceptProposal(d: SyncDeps, n: number, text: string): void {
  d.log(`#${n}: agentens förslag gäller`);
  if (!d.enforce) return;
  d.intake.comment(n, text);
  d.intake.removeLabel(n, AUTO_LABEL);
}

function veto(d: SyncDeps, item: BoardItem, labels: readonly string[], result: SyncResult): void {
  result.vetoed.push(item.number);
  const proposal = isProposal(labels);
  d.log(`#${item.number}: veto på tavlan → ${proposal ? "agentens förslag gäller inte" : "godkänns inte automatiskt"}`);
  if (!d.enforce) return;
  d.intake.removeLabel(item.number, AUTO_LABEL);
  // Ett förslag som inte gäller är en fråga Ulrik ska svara på: Svara.
  if (proposal) d.intake.addLabel(item.number, "blockerad");
  d.intake.comment(item.number, proposal ? PROPOSAL_VETO_COMMENT : VETO_COMMENT);
}

/** Agentens förslag när vetofönstret gått ut. Ger true om det gällde. */
function expireProposal(d: SyncDeps, item: BoardItem, labels: readonly string[], since: string | undefined): boolean {
  if (!proposalDue(labels, since, d.now)) return false;
  acceptProposal(d, item.number, PROPOSAL_COMMENT);
  return true;
}

/** När `auto-godkänn` senast sattes (ISO), ur händelseloggen. */
function autoSince(d: SyncDeps, n: number): string | undefined {
  return d.intake.labelEvents(n).filter((e) => e.added && e.label === AUTO_LABEL).at(-1)?.at;
}

/** Godkänner automatiskt när vetofönstret gått ut. */
/** Godkänner automatiskt när vetofönstret gått ut. Ger true om den godkändes. */
function autoApprove(d: SyncDeps, item: BoardItem, labels: readonly string[], since: string | undefined, result: SyncResult): boolean {
  if (!autoApproveDue(labels, since, d.now)) return false;
  result.autoApproved.push(item.number);
  d.log(`#${item.number}: inget veto på ${AUTO_APPROVE_MS / 3_600_000} h → verifierad`);
  if (d.enforce) {
    d.intake.comment(item.number, AUTO_COMMENT);
    d.intake.addLabel(item.number, "verifierad");
  }
  return true;
}

const workOrdersOf = (d: SyncDeps, n: number): { workOrders?: WorkOrders } => {
  const wo = d.workOrders?.get(n);
  return wo === undefined ? {} : { workOrders: wo };
};

/** Etiketterna efter det synken just gjorde (godkänt, veto eller förslag som gäller), för Läge-texten. */
function labelsAfter(labels: readonly string[], action: ColumnAction, autoApproved: boolean): readonly string[] {
  const without = labels.filter((l) => l !== AUTO_LABEL);
  if (action.kind === "veto") return isProposal(labels) ? [...without, "blockerad"] : without;
  if (action.kind !== "approve" && !autoApproved) return labels;
  return isProposal(labels) ? without : [...labels, "verifierad"];
}

/** Sätter Läge-texten när den ändrats, så att Ulrik ser att något händer. */
function applyLage(d: SyncDeps, item: BoardItem, labels: readonly string[], since: string | undefined): void {
  const text = lageFor(labels, { ...workOrdersOf(d, item.number), ...(since === undefined ? {} : { autoSince: since }) });
  if (text !== item.lage && d.enforce) d.board.setLage(item.itemId, text);
}

function setColumn(d: SyncDeps, item: BoardItem, column: Column, result: SyncResult): void {
  if (item.column !== null) result.reset.push(item.number);
  d.log(`#${item.number}: ${item.column ?? "(ingen kolumn)"} → ${column}`);
  if (d.enforce) d.board.setColumn(item.itemId, column);
}

function applyPrio(d: SyncDeps, item: BoardItem, labels: readonly string[]): void {
  const action = decidePrio(labels, item.prio);
  if (action.kind === "none" || !d.enforce) return;
  if (action.kind === "set-board") { d.board.setPrio(item.itemId, action.prio); return; }
  d.log(`#${item.number}: prio ${action.prio} från tavlan`);
  for (const l of action.remove) d.intake.removeLabel(item.number, l);
  d.intake.addLabel(item.number, `prio-${action.prio}`);
}

function applyRek(d: SyncDeps, item: BoardItem, labels: readonly string[]): void {
  const rek = rekFor(labels);
  if (rek !== null && rek !== item.rek && d.enforce) d.board.setRek(item.itemId, rek);
}

/** Ett kort på tavlan: kolumn, prio, rekommendation och automatiskt godkännande. */
function applyItem(d: SyncDeps, item: BoardItem, labels: readonly string[], result: SyncResult): void {
  const since = autoApprovable(labels) || isProposal(labels) ? autoSince(d, item.number) : undefined;
  const action = applyColumn(d, item, labels, result);
  applyPrio(d, item, labels);
  applyRek(d, item, labels);
  // Bara om Ulrik inte flyttat kortet själv (godkänt, avböjt eller lagt in veto).
  const auto = (action.kind === "none" || action.kind === "set") &&
    (autoApprove(d, item, labels, since, result) || expireProposal(d, item, labels, since));
  if (action.kind !== "decline") applyLage(d, item, labelsAfter(labels, action, auto), since);
}

const blockedWorkOrders = (code: CodeSide): OpenItem[] =>
  code.open.filter((i) => !i.isPr && i.labels.includes("agent-task") && i.labels.includes("blockerad"));

function addWorkOrderCards(d: SyncDeps, code: CodeSide, onBoard: ReadonlySet<number>, result: SyncResult): void {
  for (const wo of blockedWorkOrders(code)) {
    if (onBoard.has(wo.number) || wo.nodeId === undefined) continue;
    result.workOrders.added.push(wo.number);
    d.log(`arbetsorder #${wo.number} är blockerad: kort i Svara`);
    if (!d.enforce) continue;
    const itemId = d.board.add(wo.nodeId);
    d.board.setColumn(itemId, "Svara");
    d.board.setLage(itemId, WORK_ORDER_LAGE);
  }
}

/** Ulrik godkände arbetsordern: släpp den, och sätt tillståndet igen så att dess agent startas direkt. */
function approveWorkOrder(code: CodeSide, wo: OpenItem): void {
  code.gh.removeLabel(wo.number, "blockerad");
  code.gh.addLabel(wo.number, HUMAN_APPROVED);
  code.gh.comment(wo.number, APPROVE_WORK_ORDER);
  // En borttagen flagga startar inget; en tillståndsetikett gör det (flödesvakten).
  const state = code.states.find((s) => wo.labels.includes(s));
  if (state === undefined) return;
  code.gh.removeLabel(wo.number, state);
  code.gh.addLabel(wo.number, state);
}

function declineWorkOrder(code: CodeSide, n: number): void {
  code.gh.comment(n, DECLINE_WORK_ORDER);
  code.gh.closeIssue(n, "not_planned");
}

function archiveWorkOrderCard(d: SyncDeps, card: BoardItem, result: SyncResult): void {
  result.workOrders.archived.push(card.number);
  if (d.enforce) d.board.archive(card.itemId);
}

function recordWorkOrderMove(d: SyncDeps, n: number, move: WorkOrderMove, result: SyncResult): void {
  if (move !== "approve" && move !== "decline") return;
  d.log(`arbetsorder #${n}: ${move === "approve" ? "godkänd" : "avböjd"} på tavlan`);
  (move === "approve" ? result.workOrders.approved : result.workOrders.declined).push(n);
}

/** Verkställ Ulriks flytt av en arbetsorders kort; en avgjord (eller inte längre blockerad) arkiveras. */
function applyWorkOrderCard(d: SyncDeps, code: CodeSide, card: BoardItem, wo: OpenItem | undefined, result: SyncResult): void {
  if (!card.open || wo === undefined) {
    archiveWorkOrderCard(d, card, result);
    return;
  }
  const move = decideWorkOrder(card.column);
  recordWorkOrderMove(d, card.number, move, result);
  if (!d.enforce) return;
  if (move === "approve") approveWorkOrder(code, wo);
  else if (move === "decline") declineWorkOrder(code, card.number);
  else settleWorkOrderCard(d, card, move);
}

function settleWorkOrderCard(d: SyncDeps, card: BoardItem, move: "none" | "set"): void {
  if (move === "set") d.board.setColumn(card.itemId, "Svara");
  if (card.lage !== WORK_ORDER_LAGE) d.board.setLage(card.itemId, WORK_ORDER_LAGE);
}

/** En agent-PR för en arbetsorder som Ulrik godkänt får `människa-godkänd` med hans token (Agentvakten kräver det). */
function copyApprovals(d: SyncDeps, code: CodeSide, result: SyncResult): void {
  const approved = new Set(code.open.filter((i) => !i.isPr && i.labels.includes(HUMAN_APPROVED)).map((i) => i.number));
  for (const pr of code.open.filter((i) => i.isPr && i.labels.includes("agent-pr"))) {
    const issue = closesIssue(pr.body);
    if (issue === null || !approved.has(issue)) continue;
    approvePr(d, code, pr, issue, result);
  }
}

/**
 * Ulriks godkännande följer med till PR:en, och PR:ens `blockerad` (satt
 * medan den väntade på honom) tas bort — annars är Agentvakten röd fast
 * beslutet är fattat (#2027).
 */
function approvePr(d: SyncDeps, code: CodeSide, pr: OpenItem, issue: number, result: SyncResult): void {
  const needsLabel = !pr.labels.includes(HUMAN_APPROVED);
  const blocked = pr.labels.includes("blockerad");
  if (!needsLabel && !blocked) return;
  result.workOrders.prsApproved.push(pr.number);
  d.log(`PR #${pr.number}: arbetsorder #${issue} godkänd av Ulrik → ${HUMAN_APPROVED}${blocked ? ", blockerad bort" : ""}`);
  if (!d.enforce) return;
  if (needsLabel) code.gh.addLabel(pr.number, HUMAN_APPROVED);
  if (blocked) code.gh.removeLabel(pr.number, "blockerad");
}

/** Arbetsordrarnas kort (#1779): blockerade läggs till, Ulriks flyttar verkställs, godkännanden följer med till PR:en. */
function syncWorkOrders(d: SyncDeps, code: CodeSide, cards: readonly BoardItem[], result: SyncResult): void {
  addWorkOrderCards(d, code, new Set(cards.map((c) => c.number)), result);
  const blocked = new Map(blockedWorkOrders(code).map((i) => [i.number, i]));
  for (const card of cards) applyWorkOrderCard(d, code, card, blocked.get(card.number), result);
  copyApprovals(d, code, result);
}

/** En synk: nya kort läggs till, Ulriks flyttar verkställs, resten följer etiketterna, stängda arkiveras. */
export function syncBoard(d: SyncDeps): SyncResult {
  const result: SyncResult = {
    added: [], approved: [], declined: [], reset: [], archived: [], vetoed: [], autoApproved: [],
    workOrders: { added: [], approved: [], declined: [], archived: [], prsApproved: [] },
  };
  const all = d.board.items();
  const items = all.filter((i) => i.repo === d.intakeRepo);
  const labelsOf = new Map(d.open.map((i) => [i.number, i.labels]));
  addMissing(d, new Set(items.map((i) => i.number)), result);
  for (const item of items) {
    const labels = labelsOf.get(item.number);
    if (!item.open || labels === undefined) {
      result.archived.push(item.number);
      if (d.enforce) d.board.archive(item.itemId);
      continue;
    }
    applyItem(d, item, labels, result);
  }
  const code = d.code;
  if (code) syncWorkOrders(d, code, all.filter((i) => i.repo === code.repo), result);
  return result;
}

if (import.meta.main) {
  const token = process.env.FLOW_BOARD_TOKEN;
  const flow = loadFlow();
  const intakeRepo = flow.machines.intake?.repo;
  if (!token || !intakeRepo) {
    console.log("ingen FLOW_BOARD_TOKEN — tavlan synkas inte");
  } else {
    const run = runGhWithToken(token);
    const board = projectBoard(run, flow.ulrik, BOARD_TITLE, console.log);
    const intake = gitHub(intakeRepo, run);
    const open = intake.openItems().filter((i) => !i.isPr && !i.labels.includes("agentstatus"));
    const codeMachine = flow.machines["code-issue"];
    const codeGh = codeMachine ? gitHub(codeMachine.repo, run) : undefined;
    const code = codeMachine && codeGh ? { repo: codeMachine.repo, gh: codeGh, open: codeGh.openItems(), states: stateLabels(codeMachine) } : undefined;
    const workOrders = codeGh?.workOrders(intakeRepo);
    const r = syncBoard({
      board, intake, intakeRepo, open, enforce: process.env.FLOW_GUARD_MODE === "enforce", log: console.log, now: Date.now(),
      ...(workOrders === undefined ? {} : { workOrders }),
      ...(code === undefined ? {} : { code }),
    });
    console.log(`tavlan ${board.url}: ${r.added.length} nya, ${r.approved.length} godkända, ${r.autoApproved.length} automatiskt godkända, `
      + `${r.vetoed.length} veton, ${r.declined.length} avböjda, ${r.reset.length} tillbakalagda, ${r.archived.length} arkiverade`);
  }
}
