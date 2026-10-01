/**
 * Vakt (#1349): varje mutation i en router för en procedurägd entitet köas
 * som anrop.
 *
 * Servern tar inte emot rader för procedurägda entiteter (#1242). En mutation
 * i t.ex. `timeEntry` som INTE står i procedurregistret skriver sina rader
 * lokalt, radpushen avvisas och ändringen försvinner — så gick det för
 * "Markera som rådgivning". Undantagen nedan skriver inga procedurägda rader.
 */
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { appRouter } from "@/lib/server/routers/_app";
import { isProcedureOwned } from "@/lib/shared/sync/procedure-owned";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";

/** Mutationer i en procedurägd entitets router som medvetet inte köas — och varför. */
const NOT_QUEUED: Readonly<Record<string, string>> = {
  "matter.removeContact": "tar bort matterContact (ren data, radkön)",
  "organization.create": "skapar byrån vid uppstart — server-only, aldrig från en klient i kön",
};

/** Procedurens typ ur tRPC:s `_def` (otypad i routerns union). */
const procedureDef = z.object({ type: z.string() });

function mutationPaths(): string[] {
  return Object.entries(appRouter._def.procedures)
    .filter(([, proc]) => "_def" in proc && procedureDef.safeParse(proc._def).data?.type === "mutation")
    .map(([path]) => path);
}

describe("procedurägda entiteters mutationer köas (#1349)", () => {
  it("varje mutation i timeEntry/expense/invoice/billingRun/matter/… står i procedurregistret eller är ett motiverat undantag", () => {
    const owned = mutationPaths().filter((path) => isProcedureOwned(path.split(".")[0] ?? ""));
    expect(owned).toContain("timeEntry.markAsRadgivning");
    const loose = owned.filter((path) => !isQueuedProcedure(path) && !Object.hasOwn(NOT_QUEUED, path));
    expect(loose).toEqual([]);
  });

  it("undantagen finns och köas inte (listan hålls aktuell)", () => {
    const paths = new Set(mutationPaths());
    for (const path of Object.keys(NOT_QUEUED)) {
      expect(paths.has(path)).toBe(true);
      expect(isQueuedProcedure(path)).toBe(false);
    }
  });
});
