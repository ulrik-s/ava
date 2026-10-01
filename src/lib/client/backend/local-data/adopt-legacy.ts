/**
 * Flytta in de gemensamma databaserna från före #1347 hos den användare som
 * äger dem (`legacy-owner.ts`) — bara henne.
 *
 * Kön och de avvisade ändringarna flyttas post för post vid varje läsning
 * (`local-data-locations.ts`). Övriga databaser kopieras här, en gång per
 * start: idempotent (en nyckel som redan finns i hennes databas skrivs inte
 * över — den är nyare), med sammanslagning där en flik med gammal kod kan ha
 * lagt till något efter förra kopieringen (väntande uppladdningar, väntande
 * fakturadokument). Den gamla databasen raderas när den är kopierad; går det
 * inte (en gammal flik håller den öppen) kopieras den igen nästa gång.
 */

import { z } from "zod";
import { copyDatabase, type MergeValue } from "@/lib/server/data-store/in-memory/idb-copy";
import { deleteDatabase } from "@/lib/server/data-store/in-memory/idb-open";
import { CONTENT_PENDING_KEY } from "../content-cache";
import { LIST_STORE_KEY } from "../idb-list-store";
import { dbNameIn, LOCAL_DB, userNamespace, type LocalDbBase, type LocalScope } from "./local-namespace";

const pendingMapSchema = z.record(z.string(), z.string()).catch({});
const invoiceListSchema = z.array(z.looseObject({ invoiceId: z.string() })).catch([]);

/** Väntande uppladdningar: båda sidornas dokument; användarens egen sha vinner. */
const mergePending: MergeValue = (_store, key, existing, incoming) => (key === CONTENT_PENDING_KEY
  ? { ...pendingMapSchema.parse(incoming), ...pendingMapSchema.parse(existing) }
  : undefined);

/** Väntande fakturadokument: båda sidornas, en gång per faktura. */
const mergeDeferred: MergeValue = (_store, key, existing, incoming) => {
  if (key !== LIST_STORE_KEY) return undefined;
  const own = invoiceListSchema.parse(existing);
  const known = new Set(own.map((d) => d.invoiceId));
  return [...own, ...invoiceListSchema.parse(incoming).filter((d) => !known.has(d.invoiceId))];
};

/** Databaserna som kopieras hit, och hur ett värde som finns på båda sidor slås ihop. */
const COPIED: ReadonlyArray<[LocalDbBase, MergeValue | undefined]> = [
  [LOCAL_DB.localStore, undefined],
  [LOCAL_DB.docContent, mergePending],
  [LOCAL_DB.docText, undefined],
  [LOCAL_DB.generatedDocs, undefined],
  [LOCAL_DB.deferredFakturaDocs, mergeDeferred],
];

/** Kopiera de gemensamma databaserna till ägarens egna och radera dem. */
export async function adoptLegacyDatabases(factory: IDBFactory, owner: LocalScope): Promise<void> {
  const ns = userNamespace(owner);
  for (const [base, merge] of COPIED) {
    if (await copyDatabase(factory, base, dbNameIn(ns, base), merge)) await deleteDatabase(factory, base);
  }
}
