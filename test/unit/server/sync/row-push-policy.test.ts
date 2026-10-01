/**
 * Radvägens policy (#1344) utan databas — neka som standard, referenser,
 * vem som skapade raden, ägaren och loggar som bara kan läggas till.
 */
import { describe, expect, it } from "vitest-compat";
import {
  checkRowPolicy, immutableOnUpdate, ROW_POLICY_REASONS, ROW_PUSH_POLICY, type PolicyInput, type RefOrg,
} from "@/lib/server/sync/row-push-policy";
import { PROCEDURE_OWNED_ENTITIES } from "@/lib/shared/sync/procedure-owned";
import { uuidv7 } from "@/lib/shared/uuid";
import { pusher } from "./row-pusher";

const ME = uuidv7();
const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const OWN_MATTER = uuidv7();
const FOREIGN_MATTER = uuidv7();
const MISSING = uuidv7();

/** Ägs av ORG, utom FOREIGN_MATTER; MISSING finns inte. */
const refOrg: RefOrg = async (_entity, id) => {
  if (id === MISSING) return null;
  return id === FOREIGN_MATTER ? OTHER_ORG : ORG;
};

function input(over: Partial<PolicyInput>): PolicyInput {
  return { entity: "task", kind: "create", incoming: {}, existing: null, pusher: pusher(ORG, ME), refOrg, ...over };
}

describe("neka som standard", () => {
  it("en entitet utan policy avvisas — också en prototypnyckel", async () => {
    for (const entity of ["foo", "__proto__", "constructor", "toString"]) {
      expect(await checkRowPolicy(input({ entity }))).toEqual({ reason: ROW_POLICY_REASONS.denied });
    }
  });

  it("administrerade och procedurägda entiteter står inte i radvägens policy", () => {
    for (const entity of ["user", "organization", "office", "orgPreference", "documentTemplate", ...PROCEDURE_OWNED_ENTITIES]) {
      expect(Object.hasOwn(ROW_PUSH_POLICY, entity)).toBe(false);
    }
  });
});

describe("referenser", () => {
  it("en referens till en annan byrås rad → annan byrå", async () => {
    expect(await checkRowPolicy(input({ incoming: { matterId: FOREIGN_MATTER } }))).toEqual({ reason: "annan byrå" });
  });

  it("referensen prövas på resultatet: en ändring som bara byter ärende prövas också", async () => {
    const existing = { id: uuidv7(), matterId: OWN_MATTER, userId: ME };
    expect(await checkRowPolicy(input({ kind: "update", existing, incoming: { matterId: FOREIGN_MATTER } }))).toEqual({ reason: "annan byrå" });
  });

  it("egen rad, saknad rad och tom referens går igenom", async () => {
    expect(await checkRowPolicy(input({ incoming: { matterId: OWN_MATTER, userId: ME } }))).toBeNull();
    expect(await checkRowPolicy(input({ incoming: { matterId: MISSING } }))).toBeNull();
    expect(await checkRowPolicy(input({ incoming: { matterId: null } }))).toBeNull();
  });

  it("ett id som inte är ett uuid → ogiltig referens", async () => {
    expect(await checkRowPolicy(input({ incoming: { matterId: "m-1" } }))).toEqual({ reason: ROW_POLICY_REASONS.badRef });
    expect(await checkRowPolicy(input({ incoming: { matterId: 42 } }))).toEqual({ reason: ROW_POLICY_REASONS.badRef });
  });

  it("en radering prövar inga referenser", async () => {
    const existing = { id: uuidv7(), matterId: FOREIGN_MATTER };
    expect(await checkRowPolicy(input({ kind: "delete", incoming: null, existing }))).toBeNull();
  });
});

describe("vem som skapade raden", () => {
  it("en ny anteckning i en kollegas namn → avvisas; i eget namn → ok", async () => {
    const note = { matterId: OWN_MATTER };
    expect(await checkRowPolicy(input({ entity: "serviceNote", incoming: { ...note, authorId: uuidv7() } }))).toEqual({ reason: ROW_POLICY_REASONS.actor });
    expect(await checkRowPolicy(input({ entity: "serviceNote", incoming: note }))).toEqual({ reason: ROW_POLICY_REASONS.actor });
    expect(await checkRowPolicy(input({ entity: "serviceNote", incoming: { ...note, authorId: ME } }))).toBeNull();
  });

  it("en ändring prövar inte skaparen — fältet tas bort ur ändringen i stället", async () => {
    const existing = { id: uuidv7(), matterId: OWN_MATTER, authorId: uuidv7() };
    expect(await checkRowPolicy(input({ entity: "serviceNote", kind: "update", existing, incoming: { text: "Nytt" } }))).toBeNull();
  });
});

describe("ägaren", () => {
  it("en annan användares preferens kan inte skapas, ändras eller raderas", async () => {
    const theirs = { id: uuidv7(), userId: uuidv7(), key: "list.matters" };
    expect(await checkRowPolicy(input({ entity: "userPreference", incoming: theirs }))).toEqual({ reason: ROW_POLICY_REASONS.owner });
    expect(await checkRowPolicy(input({ entity: "userPreference", kind: "update", existing: theirs, incoming: { userId: ME } }))).toEqual({ reason: ROW_POLICY_REASONS.owner });
    expect(await checkRowPolicy(input({ entity: "userPreference", kind: "delete", existing: theirs, incoming: null }))).toEqual({ reason: ROW_POLICY_REASONS.owner });
  });

  it("en egen preferens kan inte ges bort", async () => {
    const mine = { id: uuidv7(), userId: ME, key: "list.matters" };
    expect(await checkRowPolicy(input({ entity: "userPreference", kind: "update", existing: mine, incoming: { userId: uuidv7() } }))).toEqual({ reason: ROW_POLICY_REASONS.owner });
    expect(await checkRowPolicy(input({ entity: "userPreference", kind: "update", existing: mine, incoming: { prefs: {} } }))).toBeNull();
  });
});

describe("jävskontrollens logg", () => {
  it("kan läggas till i eget namn, men aldrig ändras eller tas bort", async () => {
    const check = { id: uuidv7(), checkedById: ME, searchTerm: "Bo Berg" };
    expect(await checkRowPolicy(input({ entity: "conflictCheck", incoming: check }))).toBeNull();
    expect(await checkRowPolicy(input({ entity: "conflictCheck", kind: "update", existing: check, incoming: { searchTerm: "x" } }))).toEqual({ reason: ROW_POLICY_REASONS.appendOnly });
    expect(await checkRowPolicy(input({ entity: "conflictCheck", kind: "delete", existing: check, incoming: null }))).toEqual({ reason: ROW_POLICY_REASONS.appendOnly });
  });
});

describe("immutableOnUpdate", () => {
  it("tar bort när raden skapades och vem som skapade den", () => {
    expect(immutableOnUpdate("document", { fileName: "a.pdf", createdAt: new Date(), uploadedById: "x" })).toEqual({ fileName: "a.pdf" });
    expect(immutableOnUpdate("serviceNote", { text: "t", authorId: "x" })).toEqual({ text: "t" });
  });

  it("entiteter utan skapare behåller övriga fält", () => {
    expect(immutableOnUpdate("contact", { name: "N", createdAt: new Date() })).toEqual({ name: "N" });
    expect(immutableOnUpdate("okänd", { name: "N" })).toEqual({ name: "N" });
  });
});
