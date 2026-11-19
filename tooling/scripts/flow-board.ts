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
import { type Column, columnFor, decideColumn, decidePrio } from "./flow/board";
import { type BoardApi, type BoardItem, projectBoard } from "./flow/board-github";
import { type GitHub, gitHub, type OpenItem, runGhWithToken } from "./flow/github";
import { loadFlow } from "./flow/load";

/** Projektets namn i GitHub. */
export const BOARD_TITLE = "AVA – flödet";

/** Det synken behöver. */
export interface SyncDeps { board: BoardApi; intake: GitHub; intakeRepo: string; open: readonly OpenItem[]; enforce: boolean; log: (l: string) => void }

/** Vad en synk gjorde. */
export interface SyncResult { added: number[]; approved: number[]; declined: number[]; reset: number[]; archived: number[] }

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
  }
}

function applyColumn(d: SyncDeps, item: BoardItem, labels: readonly string[], result: SyncResult): void {
  const action = decideColumn(labels, item.column);
  if (action.kind === "none") return;
  if (action.kind === "approve") {
    result.approved.push(item.number);
    d.log(`#${item.number}: godkänd på tavlan → verifierad`);
    if (d.enforce) d.intake.addLabel(item.number, "verifierad");
    return;
  }
  if (action.kind === "decline") {
    result.declined.push(item.number);
    d.log(`#${item.number}: avböjd på tavlan → stängs`);
    if (d.enforce) {
      d.intake.comment(item.number, "Avböjd av Ulrik på tavlan. Stängs utan att byggas.");
      d.intake.closeIssue(item.number, "not_planned");
    }
    return;
  }
  setColumn(d, item, action.column, result);
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

/** En synk: nya kort läggs till, Ulriks flyttar verkställs, resten följer etiketterna, stängda arkiveras. */
export function syncBoard(d: SyncDeps): SyncResult {
  const result: SyncResult = { added: [], approved: [], declined: [], reset: [], archived: [] };
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
    applyColumn(d, item, labels, result);
    applyPrio(d, item, labels);
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
    const r = syncBoard({ board, intake, intakeRepo, open, enforce: process.env.FLOW_GUARD_MODE === "enforce", log: console.log });
    console.log(`tavlan ${board.url}: ${r.added.length} nya, ${r.approved.length} godkända, ${r.declined.length} avböjda, ${r.reset.length} tillbakalagda, ${r.archived.length} arkiverade`);
  }
}
