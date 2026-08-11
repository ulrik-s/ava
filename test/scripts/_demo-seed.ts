/**
 * Delad rigg för tester som behöver DEMONS data: kärnentiteter + den
 * kronologiska simuleringen, exakt som `generateInto` gör dem.
 *
 * Fanns förr som `populate(seed)` + `populateBilling(seed)` i sju tester. När
 * simuleringen tog över (#880) blev de raderna en parallell sanning: testerna
 * påstod saker om data ingen deploy längre producerade. `populate-billing.ts`
 * är borta sedan #882 och riggen bor här i stället, i ETT exemplar.
 *
 * Ingen egen `describe` — filnamnet börjar med `_` så test-runnern inte plockar
 * upp den som en svit.
 */

import type { BinarySink, GeneratorCaller } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { runSimulation } from "../../tooling/demo-generator/simulate/orchestrate";
import { emptyRunResult, type RunCtx } from "../../tooling/demo-generator/simulate/runner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Seeda `caller` med demons data och returnera simuleringens räknare.
 *
 * Ärendena skapas som ACTIVE — annars blockerar flödes-guarden scenariot — och
 * stängs av simuleringen på slutet enligt seedens status. Tid, utlägg,
 * motpartskontakter, dokument och tjänsteanteckningar nollas i kärnpasset:
 * simuleringen skapar dem kronologiskt, och seedens statiska rader hade blivit
 * dubbletter.
 */
export async function runDemoSeed(caller: GeneratorCaller, seed: Any, sink?: BinarySink): Promise<RunCtx["res"]> {
  const coreSeed = {
    ...seed,
    matters: (seed.matters ?? []).map((m: Any) => ({ ...m, status: "ACTIVE" })),
    timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [],
  };
  await populate(caller, coreSeed);
  const ctx: RunCtx = { c: caller, res: emptyRunResult(), ...(sink ? { sink } : {}) };
  await runSimulation(ctx, seed);
  return ctx.res;
}
