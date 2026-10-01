/**
 * Scenario 1 — vanligt arbete (#1366): alla jurister registrerar tid, utlägg
 * och anteckningar, öppnar ärenden, söker och hämtar dokument i en realistisk
 * takt (exponentialfördelad väntan kring `LOAD_THINK_MS`). Synk sker som i
 * appen: strax efter varje ändring och i bakgrunden var `LOAD_POLL_MS`.
 */

import { addContact, addExpense, addNote, downloadDocument, editTime, logTime, openMatter, searchDocuments } from "../actions";
import { ActionTally, sleep, type LoadContext, type ScenarioResult } from "../context";
import { rng, weighted, type Rng } from "../rng";
import type { VirtualUser } from "../virtual-user";

/** Det en användare har skapat och kan arbeta vidare med. */
interface UserState {
  matters: string[];
  entries: string[];
  n: number;
}

type Action = (vu: VirtualUser, s: UserState, r: Rng, ctx: LoadContext) => Promise<unknown>;

const tag = (vu: VirtualUser, s: UserState): string => `u${vu.index}.${s.n}`;

function pickMatter(s: UserState, r: Rng): string {
  const m = r.pick(s.matters);
  if (!m) throw new Error("användaren har inget ärende");
  return m;
}

/** Handlingarna och deras vikter (ungefär en arbetsdag hos en jurist). */
const ACTIONS: ReadonlyArray<readonly [number, readonly [string, Action]]> = [
  [30, ["tid", async (vu, s, r) => { s.entries.push(await logTime(vu, pickMatter(s, r), r, tag(vu, s))); }]],
  [8, ["ändra tid", (vu, s, r) => { const id = r.pick(s.entries); return id ? editTime(vu, id, r) : Promise.resolve(); }]],
  [8, ["utlägg", (vu, s, r) => addExpense(vu, pickMatter(s, r), r, tag(vu, s))]],
  [10, ["anteckning", (vu, s, r) => addNote(vu, pickMatter(s, r), tag(vu, s))]],
  [4, ["kontakt", (vu, s) => addContact(vu, tag(vu, s))]],
  [3, ["öppna ärende", async (vu, s) => { s.matters.push(await openMatter(vu, `Ärende ${tag(vu, s)}`)); }]],
  [15, ["sök", (vu, _s, r) => searchDocuments(vu, r)]],
  [10, ["hämta dokument", (vu, _s, r, ctx) => {
    const doc = r.pick(ctx.documents.get(vu.user.org.index) ?? []);
    return doc ? downloadDocument(vu, doc) : Promise.resolve(0);
  }]],
];

async function userLoop(ctx: LoadContext, vu: VirtualUser, deadline: number, tally: ActionTally): Promise<void> {
  const r = rng(ctx.config.seed + vu.index);
  const own = ctx.matters.get(vu.index);
  const state: UserState = { matters: own ? [own] : [], entries: [], n: 0 };
  let nextPoll = Date.now() + ctx.config.pollMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(r.exp(ctx.config.thinkMs), Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) break;
    if (Date.now() >= nextPoll) {
      await tally.run("bakgrundssynk", () => vu.syncNow());
      nextPoll += ctx.config.pollMs;
    }
    const picked = weighted(r, ACTIONS);
    if (!picked) continue;
    const [name, action] = picked;
    state.n++;
    await tally.run(name, () => action(vu, state, r, ctx));
  }
}

export async function runWork(ctx: LoadContext): Promise<ScenarioResult> {
  const start = Date.now();
  const tally = new ActionTally();
  const deadline = start + ctx.config.durationS * 1000;
  await Promise.all(ctx.users.map((vu) => userLoop(ctx, vu, deadline, tally)));
  // Det som skrevs de sista sekunderna ska också nå servern.
  const drained = await Promise.all(ctx.users.map((vu) => vu.drain(60_000).then(() => true, (e: unknown) => { tally.fail("tömning", e); return false; })));
  const violations = drained.every(Boolean) ? [] : ["vanligt arbete: köerna tömdes inte inom 60 s efteråt"];
  return { scenario: "work", durationMs: Date.now() - start, details: { durationS: ctx.config.durationS, actions: tally.toJSON() }, violations };
}
