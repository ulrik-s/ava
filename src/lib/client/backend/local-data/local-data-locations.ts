/**
 * Var kön och de avvisade ändringarna ligger i en namnrymd (#1347).
 *
 *   - `shared` (demon): som före #1347 — `<namn>-v2`, med den gamla listan.
 *   - `user`: användarens egen databas (`<namn>@<byrå>:<användare>`). Äger hon
 *     de gemensamma databaserna från före #1347 flyttas deras poster hit vid
 *     varje läsning, post för post (`EntryStoreLegacy`): idempotent, ingen köad
 *     ändring försvinner, och de gamla databaserna uppgraderas aldrig. En
 *     annan användare läser dem aldrig.
 */

import { z } from "zod";
import {
  EntryStoreLegacy, IdbEntryStore, v2Location, type EntryStoreLocation, type LegacyListPlace,
} from "@/lib/server/data-store/in-memory/idb-entry-store";
import { QUEUE_LEGACY_LIST } from "@/lib/server/data-store/in-memory/mutation-queue";
import { REJECTED_LEGACY_LIST } from "../rejected-changes";
import { dbNameIn, LOCAL_DB, type LocalDbBase, type LocalNamespace } from "./local-namespace";

/** Namnrymden, och om användaren äger de gemensamma databaserna från före #1347. */
export interface LocalDataPlace {
  factory: IDBFactory;
  ns: LocalNamespace;
  /** Flytta in de gemensamma databasernas poster (bara deras ägare, se `legacy-owner.ts`). */
  adoptsLegacy: boolean;
}

function entryLocation(place: LocalDataPlace, base: LocalDbBase, list: LegacyListPlace): EntryStoreLocation {
  const shared = v2Location(place.factory, base, list);
  if (place.ns.kind === "shared") return shared;
  const legacy = place.adoptsLegacy
    ? [new EntryStoreLegacy(new IdbEntryStore({ factory: place.factory, location: shared, schema: z.unknown() }))]
    : [];
  return { name: dbNameIn(place.ns, base), legacy };
}

/** Var kön ligger. */
export function queueLocation(place: LocalDataPlace): EntryStoreLocation {
  return entryLocation(place, LOCAL_DB.mutationQueue, QUEUE_LEGACY_LIST);
}

/** Var de avvisade ändringarna ligger. */
export function rejectedLocation(place: LocalDataPlace): EntryStoreLocation {
  return entryLocation(place, LOCAL_DB.rejectedChanges, REJECTED_LEGACY_LIST);
}
