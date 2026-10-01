/**
 * Simuleringstester för synken (#1268, #1358, ADR 0037).
 *
 * Två byråer, roller (ADMIN/LAWYER/ASSISTANT, och en degraderad användare
 * vars webbläsare fortfarande tror att den är administratör), webbläsare med
 * flera flikar över samma IndexedDB, samtidiga steg i seedad ordning, avbrott
 * (också mitt i en synk), tappade svar, omstarter och manipulerade köposter.
 * Förloppet är seedat: samma seed ger samma förlopp, så ett fel går att
 * återskapa med `AVA_SIM_SEED=<seed>`. Invarianterna står i `invariants.ts`.
 *
 * Avvikelser som beror på kända, öppna buggar (#1402) rapporteras
 * separat och fäller inte testet; `AVA_SIM_STRICT=1` räknar dem som fel.
 *
 * Budget: på varje PR körs ett litet, fast antal seeds (unit-passet är nära
 * sin tidsgräns). `bun run test:sim` och den nattliga körningen
 * (`sync-simulation.yml`) sätter `AVA_SIM_HEAVY=1` och `AVA_SIM_SEEDS` och
 * prövar många fler, med fler webbläsare och flikar.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { simulate } from "./simulate";

const HEAVY = process.env.AVA_SIM_HEAVY === "1";
const COUNT = Number(process.env.AVA_SIM_SEEDS ?? (HEAVY ? 50 : 6));
const ONLY = process.env.AVA_SIM_SEED;
const SEEDS = ONLY ? [Number(ONLY)] : Array.from({ length: COUNT }, (_, i) => 1358 + i * 7919);
const STEPS = Number(process.env.AVA_SIM_STEPS ?? (HEAVY ? 80 : 30));
const CONCURRENCY = Number(process.env.AVA_SIM_CONCURRENCY ?? 3);

describe("synksimulering (#1268, #1358)", () => {
  const prevIdb = Reflect.get(globalThis, "indexedDB");
  beforeAll(() => { Reflect.set(globalThis, "indexedDB", new IDBFactory()); });
  afterAll(() => { Reflect.set(globalThis, "indexedDB", prevIdb); });

  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} vågor, upp till ${CONCURRENCY} samtidiga steg — invarianterna håller`, async () => {
      const result = await simulate(seed, { steps: STEPS, concurrency: CONCURRENCY, heavy: HEAVY });
      if (process.env.AVA_SIM_DEBUG) console.log(JSON.stringify({ seed, stats: result.stats, known: result.known }, null, 1));
      // Förloppet skrivs ut vid fel, så det går att följa (och återskapas med seeden).
      expect({ seed, violations: result.violations, steps: result.violations.length ? result.steps : [] }).toEqual({ seed, violations: [], steps: [] });
    }, 300_000);
  }

  // Kända, öppna buggar som simuleringen hittar. Avvikelserna räknas inte som
  // fel än (se `knownBug` i invariants.ts); `AVA_SIM_STRICT=1` gör det.
  const pending = (): void => undefined;
  it.todo("flera flikar: en avvisad ändring lämnar inga spökrader i fliken som gjorde den (#1402)", pending);
});
