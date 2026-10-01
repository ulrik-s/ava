/**
 * Konvergens (#1366): efter körningen ska varje klients lokala läge vara
 * serverns. Alla synkar tills köerna är tomma, och två rundor till så att
 * alla sett allas sista ändringar; sedan jämförs vy för vy.
 */

import { dbFor, usersInOrg, type LoadContext } from "./context";
import { diffViews, project, type Projected } from "./invariants";
import { CONVERGENCE_VIEW_NAMES, CONVERGENCE_VIEWS, type ConvergenceView } from "./server-db";
import { VirtualUser } from "./virtual-user";

export interface ConvergenceResult {
  clients: number;
  views: readonly ConvergenceView[];
  mismatches: string[];
  /**
   * En NY klient per byrå (pull från cursor 0) jämförd med servern. Konvergerar
   * den men inte de långlivade klienterna har de senare missat ändringar på
   * vägen (t.ex. en cursor som hoppat förbi en rad) — inte fått fel data.
   */
  freshClientMismatches: string[];
}

const VIEWS = CONVERGENCE_VIEW_NAMES;

/** Avvikelser mellan en klient och serverns vyer. */
function compare(vu: VirtualUser, server: ReadonlyMap<ConvergenceView, readonly Projected[]>, label: string): string[] {
  return VIEWS.flatMap((v) => diffViews(`${label} ${v}`, project(vu.rows(v), CONVERGENCE_VIEWS[v].fields), server.get(v) ?? []));
}

/** Starta en ny klient som en av byråns jurister och synka från början. */
async function freshClient(ctx: LoadContext, like: VirtualUser): Promise<VirtualUser> {
  const vu = new VirtualUser(0, like.user, ctx.recorder);
  await vu.boot();
  await vu.syncNow();
  return vu;
}

export async function checkConvergence(ctx: LoadContext): Promise<ConvergenceResult> {
  const mismatches: string[] = [];
  for (const vu of ctx.users) vu.online = true;
  await Promise.all(ctx.users.map((vu) => vu.drain(120_000).catch((e: unknown) => { mismatches.push(`${vu.user.email}: ${String(e)}`); })));
  for (let round = 0; round < 2; round++) await Promise.all(ctx.users.map((vu) => vu.syncNow()));
  const freshClientMismatches: string[] = [];
  for (const org of ctx.config.orgs) {
    const db = dbFor(ctx, org.index);
    const server = new Map(await Promise.all(VIEWS.map(async (v) => [v, await db.view(v)] as const)));
    const users = usersInOrg(ctx, org.index);
    for (const vu of users) mismatches.push(...compare(vu, server, vu.user.email));
    const first = users[0];
    if (first) freshClientMismatches.push(...compare(await freshClient(ctx, first), server, `ny klient byrå ${org.index}`));
  }
  return { clients: ctx.users.length, views: VIEWS, mismatches, freshClientMismatches };
}
