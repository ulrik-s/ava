/**
 * Simuleringstester för synken (#1268, ADR 0037).
 *
 * Flera klienter mot en server, med slumpade ändringar, avbrott (också mitt i
 * en synk), omstarter och omordning. Förloppet är seedat: samma seed ger samma
 * förlopp, så ett fel går att återskapa med `AVA_SIM_SEED=<seed>`.
 *
 * Invarianter efter varje förlopp:
 *   - ingen ändring försvinner tyst: varje köpost fick ett utfall på servern,
 *     och en avvisning syns i klientens avvisade ändringar,
 *   - klienterna konvergerar mot serverns läge,
 *   - inga dubbla fakturanummer,
 *   - serverläget är detsamma som en seriell körning av de accepterade
 *     ändringarna, i den ordning servern tillämpade dem.
 *
 * På varje PR körs ett fast antal seeds. Den nattliga körningen sätter
 * `AVA_SIM_SEEDS` (antal) och prövar fler.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { simulate } from "./simulate";

const COUNT = Number(process.env.AVA_SIM_SEEDS ?? 8);
const ONLY = process.env.AVA_SIM_SEED;
const SEEDS = ONLY ? [Number(ONLY)] : Array.from({ length: COUNT }, (_, i) => 1268 + i * 7919);
const STEPS = Number(process.env.AVA_SIM_STEPS ?? 60);

describe("synksimulering (#1268)", () => {
  const prevIdb = Reflect.get(globalThis, "indexedDB");
  beforeAll(() => { Reflect.set(globalThis, "indexedDB", new IDBFactory()); });
  afterAll(() => { Reflect.set(globalThis, "indexedDB", prevIdb); });

  for (const seed of SEEDS) {
    it(`seed ${seed}: ${seed % 2 === 0 ? 3 : 2} klienter, ${STEPS} steg — invarianterna håller`, async () => {
      const result = await simulate(seed, { clients: seed % 2 === 0 ? 3 : 2, steps: STEPS });
      // Förloppet skrivs ut vid fel, så det går att följa (och återskapas med seeden).
      expect({ seed, violations: result.violations, steps: result.violations.length ? result.steps : [] }).toEqual({ seed, violations: [], steps: [] });
    }, 120_000);
  }
});
