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
  AUTO_APPROVE_MS, AUTO_LABEL, autoApprovable, autoApproveDue, type Column, type ColumnAction, columnFor, decideColumn, decidePrio, lageFor, rekFor,
} from "./flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "./flow/board-github";
import { type GitHub, gitHub, type OpenItem, runGhWithToken, type WorkOrderProgress } from "./flow/github";
import { loadFlow } from "./flow/load";

/** Projektets namn i GitHub. */
export const BOARD_TITLE = "AVA – flödet";

/**
 * Det synken behöver. `now` styr vetofönstret för det automatiska godkännandet,
 * `workOrders` (arbetsordrarnas framsteg per förfrågan) Läge-texten för det som byggs.
 */
export interface SyncDeps {
  board: BoardApi; intake: GitHub; intakeRepo: string; open: readonly OpenItem[]; enforce: boolean; log: (l: string) => void; now: number;
  workOrders?: WorkOrderProgress;
}

/** Vad en synk gjorde. */
export interface SyncResult {
  added: number[]; approved: number[]; declined: number[]; reset: number[]; archived: number[]; vetoed: number[]; autoApproved: number[];
}

/**
 * Markören först i synkens kommentarer: de är tavlans, inte Ulriks egna ord,
 * fast de skrivs med hans token (agenterna läser Ulriks kommentarer som beslut).
 */
export const BOARD_MARKER = "<!-- tavlan -->";

const AUTO_COMMENT = `${BOARD_MARKER}\nGodkänd automatiskt: ${AUTO_APPROVE_MS / 3_600_000} timmar i "Godkänns automatiskt" utan veto. ` +
  "Loop 1 bedömde den som en liten bekräftad bugg eller ett internt verktyg, inom ADR:erna och utan risk (pengar, inloggning, migration, klientdata). " +
  "Var det fel: ta bort `verifierad` innan loop 2 hunnit bryta ner den, eller stäng den.";
const VETO_COMMENT = `${BOARD_MARKER}\nVeto på tavlan: godkänns inte automatiskt. Ulrik beslutar själv (Att besluta).`;

function addMissing(d: SyncDeps, onBoard: ReadonlySet<number>, result: SyncResult): void {
  for (const i of d.open) {
    if (onBoard.has(i.number) || i.nodeId === undefined) continue;
    result.added.push(i.number);
    d.log(`#${i.number}: läggs på tavlan i ${columnFor(i.labels)}`);
    if (!d.enforce) continue;
    const itemId = d.board.add(i.nodeId);
    d.board.setColumn(itemId, columnFor(i.labels));
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
    result.approved.push(item.number);
    d.log(`#${item.number}: godkänd på tavlan → verifierad`);
    if (d.enforce) d.intake.addLabel(item.number, "verifierad");
  } else if (action.kind === "decline") {
    result.declined.push(item.number);
    d.log(`#${item.number}: avböjd på tavlan → stängs`);
    if (d.enforce) {
      d.intake.comment(item.number, "Avböjd av Ulrik på tavlan. Stängs utan att byggas.");
      d.intake.closeIssue(item.number, "not_planned");
    }
  } else if (action.kind === "veto") {
    veto(d, item, result);
  } else if (action.kind === "set") {
    setColumn(d, item, action.column, result);
  }
  return action;
}

function veto(d: SyncDeps, item: BoardItem, result: SyncResult): void {
  result.vetoed.push(item.number);
  d.log(`#${item.number}: veto på tavlan → godkänns inte automatiskt`);
  if (!d.enforce) return;
  d.intake.removeLabel(item.number, AUTO_LABEL);
  d.intake.comment(item.number, VETO_COMMENT);
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

const workOrdersOf = (d: SyncDeps, n: number): { workOrders?: { done: number; total: number } } => {
  const wo = d.workOrders?.get(n);
  return wo === undefined ? {} : { workOrders: wo };
};

/** Etiketterna efter det synken just gjorde (godkänt eller veto), för Läge-texten. */
function labelsAfter(labels: readonly string[], action: ColumnAction, autoApproved: boolean): readonly string[] {
  if (action.kind === "approve" || autoApproved) return [...labels, "verifierad"];
  return action.kind === "veto" ? labels.filter((l) => l !== AUTO_LABEL) : labels;
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
  const since = autoApprovable(labels) ? autoSince(d, item.number) : undefined;
  const action = applyColumn(d, item, labels, result);
  applyPrio(d, item, labels);
  applyRek(d, item, labels);
  // Bara om Ulrik inte flyttat kortet själv (godkänt, avböjt eller lagt in veto).
  const auto = (action.kind === "none" || action.kind === "set") && autoApprove(d, item, labels, since, result);
  if (action.kind !== "decline") applyLage(d, item, labelsAfter(labels, action, auto), since);
}

/** En synk: nya kort läggs till, Ulriks flyttar verkställs, resten följer etiketterna, stängda arkiveras. */
export function syncBoard(d: SyncDeps): SyncResult {
  const result: SyncResult = { added: [], approved: [], declined: [], reset: [], archived: [], vetoed: [], autoApproved: [] };
  const items = d.board.items().filter((i) => i.repo === d.intakeRepo);
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
    const codeRepo = flow.machines["code-issue"]?.repo;
    const workOrders = codeRepo === undefined ? undefined : gitHub(codeRepo, run).workOrders(intakeRepo);
    const r = syncBoard({
      board, intake, intakeRepo, open, enforce: process.env.FLOW_GUARD_MODE === "enforce", log: console.log, now: Date.now(),
      ...(workOrders === undefined ? {} : { workOrders }),
    });
    console.log(`tavlan ${board.url}: ${r.added.length} nya, ${r.approved.length} godkända, ${r.autoApproved.length} automatiskt godkända, `
      + `${r.vetoed.length} veton, ${r.declined.length} avböjda, ${r.reset.length} tillbakalagda, ${r.archived.length} arkiverade`);
  }
}
