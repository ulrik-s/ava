/**
 * Orkestrering av den kronologiska seedningen (#880): för varje ärende härleds en
 * `SimMatter` + parter ur (den översatta) seeden, ett scenario byggs efter ärendetyp
 * och spelas upp kronologiskt via `runScenario`. Ärenden som ska vara avslutade körs
 * som ACTIVE under scenariot (annars blockerar flödes-guarden) och stängs på slutet.
 *
 * Ersätter de gamla kategori-passen (populateBilling/populateUnbilledTime + seedens
 * statiska tid/utlägg/kontakter/dokument).
 */

import { TIMKOSTNADSNORM_FTAX_ORE_PER_H } from "@/lib/shared/brottmalstaxa";
import type { Parties, SimMatter } from "./events";
import type { RunCtx } from "./runner";
import { runScenario } from "./runner";
import { buildScenario } from "./scenarios";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const MS_DAY = 86_400_000;
const DEFAULT_RATE_ORE = 250_000;

function daysSince(iso: unknown): number {
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / MS_DAY)) : 30;
}

function deriveSim(m: Any, lawyerId: string, rateOre: number): SimMatter {
  const isRh = String(m.paymentMethod) === "RATTSHJALP";
  return {
    id: String(m.id),
    ...(m.matterNumber ? { matterNumber: String(m.matterNumber) } : {}),
    paymentMethod: String(m.paymentMethod), clientShareBips: m.clientShareBips ?? null,
    lawyerId, startDaysAgo: daysSince(m.createdAt),
    arvodeRateOre: isRh ? TIMKOSTNADSNORM_FTAX_ORE_PER_H : (rateOre || DEFAULT_RATE_ORE),
  };
}

/** Parter ur seedens matterContacts (klient/motpart/ombud/domstol) → party-events. */
function deriveParties(matterId: string, seedContacts: Any[]): Parties {
  const mine = seedContacts.filter((c) => String(c.matterId) === matterId);
  const byRole = (role: string): string | undefined => {
    const hit = mine.find((c) => String(c.role) === role);
    return hit ? String(hit.contactId) : undefined;
  };
  return { klient: byRole("KLIENT"), motpart: byRole("MOTPART"), motpartsombud: byRole("MOTPARTSOMBUD"), domstol: byRole("DOMSTOL") };
}

/** Kör ett ärendes scenario + stäng det om seedens status inte är ACTIVE. */
async function simulateMatter(ctx: RunCtx, m: Any, users: { id: string; rateOre: number }[], seedContacts: Any[], index: number): Promise<void> {
  // Seed-ärenden saknar responsibleLawyerId → välj ansvarig jurist deterministiskt ur
  // användarlistan (som gamla buildTimeEntries: round-robin per ärende-index).
  const u = users[index % Math.max(1, users.length)];
  if (!u) return;
  const sim = deriveSim(m, u.id, u.rateOre);
  await runScenario(ctx, sim, buildScenario(sim, deriveParties(String(m.id), seedContacts), index));
  if (String(m.status) !== "ACTIVE") await ctx.c.matter.update({ id: sim.id, status: String(m.status) });
}

/** Spela upp alla ärendens scenarier. `seed` = den ÖVERSATTA seeden (UUID-id). */
export async function runSimulation(ctx: RunCtx, seed: Any): Promise<void> {
  // Byråns aconto-gränsbelopp (#885) driver tröskelstyrda aconton i runnern.
  const orgThreshold = seed.organizations?.[0]?.accontoThresholdOre;
  if (typeof orgThreshold === "number") ctx.accontoThresholdOre = orgThreshold;
  const users: { id: string; rateOre: number }[] = (seed.users ?? [])
    .filter((u: Any) => typeof u.id === "string")
    .map((u: Any) => ({ id: String(u.id), rateOre: Number(u.hourlyRate ?? 0) || 0 }));
  // Parterna länkas kronologiskt ur seedens matterContacts (klient/motpart/ombud/domstol).
  const seedContacts: Any[] = seed.matterContacts ?? [];
  let index = 0;
  for (const m of seed.matters ?? []) {
    await simulateMatter(ctx, m, users, seedContacts, index);
    index++;
  }
}
