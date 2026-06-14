/**
 * #39 — branded id:n ska nå ända ut till tRPC-router-output, inte tvättas bort
 * till `any` vid `Joined<Row>`-gränsen i datalagret.
 *
 * Detta är ett TYP-NIVÅ-kontrakt: assertions:erna nedan verifieras av
 * `bun run typecheck` (include: **\/*.ts). Om en delegate åter-typas till
 * `Delegate<any>`, eller `Joined` återinför en `[k: string]: any`-index-
 * signatur, blir `.id` `any` igen → dessa rader blir röda. Runtime-testet
 * finns bara så vitest räknar filen.
 */

import type { inferRouterOutputs } from "@trpc/server";
import { describe, it, expect } from "vitest-compat";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId, ContactId } from "@/lib/shared/schemas/ids";

type Out = inferRouterOutputs<AppRouter>;

// `0 extends (1 & T)` är sant ENDAST för `any` — fångar wash-out-regression.
type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;

// matter.getById().id är MatterId (och INTE any/plain string).
type _matterId = Assert<
  IsAny<Out["matter"]["getById"]["id"]> extends true
    ? false
    : Out["matter"]["getById"]["id"] extends MatterId
      ? true
      : false
>;

// contact.getById().id är ContactId (och INTE any/plain string).
type _contactId = Assert<
  IsAny<Out["contacts"]["getById"]["id"]> extends true
    ? false
    : Out["contacts"]["getById"]["id"] extends ContactId
      ? true
      : false
>;

// Korsbrand: en MatterId får INTE vara assignable till ContactId-utdata.
type _distinct = Assert<Out["matter"]["getById"]["id"] extends ContactId ? false : true>;

describe("branded id:n når router-output (#39)", () => {
  it("är ett typ-nivå-kontrakt som verifieras av tsc", () => {
    // De faktiska assertions:erna är typerna ovan; om de inte håller blir
    // `bun run typecheck` rött. Här bekräftar vi bara att filen körs.
    expect(true).toBe(true);
  });
});
