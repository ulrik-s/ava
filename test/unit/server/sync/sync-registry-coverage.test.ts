/**
 * Synkregistren säger samma sak om varje entitet (#1678).
 *
 * Reglerna per entitet står i fem register:
 *   - `procedure-owned.ts` — entiteterna bara procedurkön skriver,
 *   - `row-push-policy.ts` — entiteterna radkön tar emot, och hur,
 *   - `queued-procedures.ts` — anropen som köas och entiteten de skriver,
 *   - `conflict-policy.ts` — konfliktklassen (append, lww, surface),
 *   - `server-owned-fields.ts` — fält en radpush aldrig skriver.
 *
 * Grinden prövar att de stämmer med varandra:
 *   1. varje synkad entitet skrivs på exakt ett sätt: procedurägd eller radpush,
 *   2. registren nämner bara synkade entiteter, och synkens entitetslista
 *      (`SOURCE_KEY_BY_ENTITY`) är densamma som ENTITY_REGISTRY,
 *   3. en köad procedur skriver en procedurägd entitet. Annars skrivs entiteten
 *      på två vägar, och radvägen kringgår procedurens regler,
 *   4. konfliktklassen följer skrivsättet. En procedurägd entitet är `surface`:
 *      servern kör om reglerna mot aktuellt läge, och klienten klassar redan
 *      procedur-anrop så. En radpush-entitet som bara får läggas till är
 *      `append`. En som får ändras är inte `append`,
 *   5. fält som servern äger finns bara på radpush-entiteter, annars rensas inget.
 *
 * Listan över kända avvikelser är en ratchet (`tooling/scripts/ratchet.ts`).
 */

import { describe, expect, it } from "vitest-compat";
import { SOURCE_KEY_BY_ENTITY } from "@/lib/server/data-store/in-memory/entity-source-keys";
import { ROW_PUSH_POLICY } from "@/lib/server/sync/row-push-policy";
import { withoutServerOwned } from "@/lib/server/sync/server-owned-fields";
import { conflictClassOf, type ConflictClass } from "@/lib/shared/conflict-policy";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { PROCEDURE_OWNED_ENTITIES } from "@/lib/shared/sync/procedure-owned";
import { QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";
import { type KnownDeviation, ratchetDiff } from "../../../../tooling/scripts/ratchet";

const STALE_MATRIX: KnownDeviation = {
  why: "ADR 0017:s konfliktmatris från före procedurkön (ADR 0037). Klassen används inte för procedurägda rader, som avvisas före konfliktprövningen.",
  issue: 1696,
};
const EDITABLE_APPEND: KnownDeviation = {
  why: "Raden ändras via radkön men klassas som append. Servern behandlar append och lww lika, så bara etiketten i konfliktvyn är fel.",
  issue: 1696,
};

/** Kända avvikelser: `entitet: regel`. */
const KNOWN: Readonly<Record<string, KnownDeviation>> = {
  "document: skrivs av köade procedurer men är inte procedurägd": {
    why: "document.analyze köas för att klassningen är en serversidoeffekt (#1156); metadata går via radkön, där server-owned-fields skyddar analysen.",
    issue: 1697,
  },
  "timeEntry: procedurägd men konfliktklass append": STALE_MATRIX,
  "expense: procedurägd men konfliktklass append": STALE_MATRIX,
  "payment: procedurägd men konfliktklass append": STALE_MATRIX,
  "paymentPlanReminder: procedurägd men konfliktklass append": STALE_MATRIX,
  "billingRun: procedurägd men konfliktklass append": STALE_MATRIX,
  "writeOff: procedurägd men konfliktklass append": STALE_MATRIX,
  "accontoDeduction: procedurägd men konfliktklass append": STALE_MATRIX,
  "matter: procedurägd men konfliktklass lww": STALE_MATRIX,
  "orgPreference: procedurägd men konfliktklass lww": STALE_MATRIX,
  "document: får ändras via radkön men konfliktklass append": EDITABLE_APPEND,
  "calendarEvent: får ändras via radkön men konfliktklass append": EDITABLE_APPEND,
};

/** Registren grinden läser — ett värde, så att testet kan pröva grinden mot ett ändrat register. */
interface Registers {
  readonly synced: readonly string[];
  readonly procedureOwned: ReadonlySet<string>;
  readonly rowPolicy: Readonly<Record<string, { readonly appendOnly?: true }>>;
  readonly queuedEntities: readonly string[];
  readonly sourceKeys: readonly string[];
  readonly conflictClass: (entity: string) => ConflictClass;
  readonly hasServerOwned: (entity: string) => boolean;
}

/** Rensar radvägen fält som servern äger för entiteten? */
function hasServerOwnedFields(entity: string): boolean {
  const analyzedAt = "2026-11-18T08:00:00.000Z";
  return !("analysisStatus" in withoutServerOwned(entity, { analyzedAt }, { analyzedAt, analysisStatus: "DONE" }));
}

const REGISTERS: Registers = {
  synced: Object.keys(ENTITY_REGISTRY),
  procedureOwned: PROCEDURE_OWNED_ENTITIES,
  rowPolicy: ROW_PUSH_POLICY,
  queuedEntities: Object.values(QUEUED_PROCEDURES).map((spec) => spec.entity),
  sourceKeys: Object.keys(SOURCE_KEY_BY_ENTITY),
  conflictClass: conflictClassOf,
  hasServerOwned: hasServerOwnedFields,
};

const isRowPushed = (r: Registers, entity: string): boolean => Object.hasOwn(r.rowPolicy, entity);

/** 1. Exakt ett skrivsätt. */
function writePathDeviations(r: Registers): string[] {
  return r.synced.flatMap((entity) => {
    const ways = Number(r.procedureOwned.has(entity)) + Number(isRowPushed(r, entity));
    return ways === 1 ? [] : [`${entity}: skrivs på ${ways} sätt`];
  });
}

/** 2. Registren nämner bara synkade entiteter; synkens lista är ENTITY_REGISTRY. */
function unknownEntityDeviations(r: Registers): string[] {
  const registers: ReadonlyArray<readonly [string, Iterable<string>]> = [
    ["procedure-owned", r.procedureOwned],
    ["row-push-policy", Object.keys(r.rowPolicy)],
    ["queued-procedures", r.queuedEntities],
    ["SOURCE_KEY_BY_ENTITY", r.sourceKeys],
  ];
  const unknown = registers.flatMap(([name, entities]) =>
    [...new Set(entities)].filter((e) => !r.synced.includes(e)).map((e) => `${e}: okänd entitet i ${name}`));
  const unsynced = r.synced.filter((e) => !r.sourceKeys.includes(e)).map((e) => `${e}: saknas i SOURCE_KEY_BY_ENTITY`);
  return [...unknown, ...unsynced];
}

/** 3. En köad procedur skriver en procedurägd entitet. */
function dualWriterDeviations(r: Registers): string[] {
  return [...new Set(r.queuedEntities)].filter((e) => !r.procedureOwned.has(e)).map((e) => `${e}: skrivs av köade procedurer men är inte procedurägd`);
}

function conflictClassDeviation(r: Registers, entity: string): string | null {
  const actual = r.conflictClass(entity);
  if (r.procedureOwned.has(entity)) return actual === "surface" ? null : `${entity}: procedurägd men konfliktklass ${actual}`;
  const policy = r.rowPolicy[entity];
  if (!policy) return null; // inget skrivsätt alls — regel 1 säger till
  if (policy.appendOnly) return actual === "append" ? null : `${entity}: får bara läggas till men konfliktklass ${actual}`;
  return actual === "append" ? `${entity}: får ändras via radkön men konfliktklass append` : null;
}

/** 4. Konfliktklassen följer skrivsättet. */
function conflictClassDeviations(r: Registers): string[] {
  return r.synced.flatMap((entity) => conflictClassDeviation(r, entity) ?? []);
}

/** 5. Server-ägda fält bara på radpush-entiteter. */
function serverOwnedDeviations(r: Registers): string[] {
  return r.synced.filter((e) => r.hasServerOwned(e) && !isRowPushed(r, e)).map((e) => `${e}: server-ägda fält men ingen radpush`);
}

function allDeviations(r: Registers): string[] {
  return [
    ...writePathDeviations(r), ...unknownEntityDeviations(r), ...dualWriterDeviations(r),
    ...conflictClassDeviations(r), ...serverOwnedDeviations(r),
  ];
}

describe("synkregistren täcker varje entitet, en gång (#1678)", () => {
  it("registren stämmer med varandra — utom de listade avvikelserna", () => {
    expect(ratchetDiff(allDeviations(REGISTERS), Object.keys(KNOWN))).toEqual({ added: [], gone: [] });
  });

  it("varje synkad entitet skrivs på exakt ett sätt, och registren känner bara synkade entiteter", () => {
    expect(writePathDeviations(REGISTERS)).toEqual([]);
    expect(unknownEntityDeviations(REGISTERS)).toEqual([]);
    expect(serverOwnedDeviations(REGISTERS)).toEqual([]);
  });

  it("jävskontrollens logg får bara läggas till och är append i konfliktpolicyn", () => {
    expect(ROW_PUSH_POLICY.conflictCheck?.appendOnly).toBe(true);
    expect(conflictClassDeviation(REGISTERS, "conflictCheck")).toBeNull();
  });

  it("dokumentet är den enda entiteten med fält som servern äger", () => {
    expect(REGISTERS.synced.filter(hasServerOwnedFields)).toEqual(["document"]);
  });

  it("grinden ser en ny avvikelse i vart och ett av registren", () => {
    const changed = (over: Partial<Registers>): readonly string[] => ratchetDiff(allDeviations({ ...REGISTERS, ...over }), Object.keys(KNOWN)).added;
    expect(changed({ rowPolicy: { ...ROW_PUSH_POLICY, invoice: {} } })).toEqual(["invoice: skrivs på 2 sätt"]);
    expect(changed({ procedureOwned: new Set([...PROCEDURE_OWNED_ENTITIES].filter((e) => e !== "accontoDeduction")) }))
      .toEqual(["accontoDeduction: skrivs på 0 sätt"]);
    expect(changed({ queuedEntities: [...REGISTERS.queuedEntities, "task"] })).toEqual(["task: skrivs av köade procedurer men är inte procedurägd"]);
    expect(changed({ sourceKeys: [...REGISTERS.sourceKeys, "spöke"] })).toEqual(["spöke: okänd entitet i SOURCE_KEY_BY_ENTITY"]);
    expect(changed({ conflictClass: (e) => (e === "conflictCheck" ? "surface" : conflictClassOf(e)) }))
      .toEqual(["conflictCheck: får bara läggas till men konfliktklass surface"]);
    expect(changed({ conflictClass: (e) => (e === "contact" ? "append" : conflictClassOf(e)) }))
      .toEqual(["contact: får ändras via radkön men konfliktklass append"]);
    expect(changed({ hasServerOwned: (e) => e === "invoice" })).toEqual(["invoice: server-ägda fält men ingen radpush"]);
  });
});
