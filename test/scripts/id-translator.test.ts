/**
 * `IdTranslator` — backbone för att översätta slug-style seed-IDs till
 * deterministiska UUIDv5 innan demo-generatorn anropar tRPC-mutations.
 *
 * Designkrav (TDD):
 *   - slug → samma uuid vid varje anrop (deterministisk via uuidv5)
 *   - uuid in → uuid ut (idempotent)
 *   - reverse-lookup `slugFor(uuid)` används av meta.json-publiceringen
 *   - `translateIds(row)` skriver om `id` + alla `*Id`-fält i en post
 *   - cyklomatisk komplexitet ≤ 8 per funktion (regel i AGENTS.md)
 */
import { describe, it, expect } from "vitest-compat";
import { createIdTranslator, translateIds, translateSeed } from "../../tooling/demo-generator/id-translator";
import { uuidv5, AVA_NAMESPACE } from "../../src/lib/shared/uuid-derive";
import { isUuid } from "../../src/lib/shared/uuid";

describe("IdTranslator.toUuid", () => {
  it("returnerar UUID v5 deterministisk per slug", () => {
    const t = createIdTranslator();
    const a = t.toUuid("u-anna");
    const b = t.toUuid("u-anna");
    expect(a).toBe(b);
    expect(a).toBe(uuidv5("u-anna", AVA_NAMESPACE));
    expect(isUuid(a)).toBe(true);
  });

  it("ger olika UUID:n för olika slugs", () => {
    const t = createIdTranslator();
    expect(t.toUuid("u-anna")).not.toBe(t.toUuid("u-bjorn"));
  });

  it("passerar genom UUID:n oförändrade (idempotent)", () => {
    const t = createIdTranslator();
    const existingUuid = "01234567-89ab-cdef-0123-456789abcdef";
    expect(t.toUuid(existingUuid)).toBe(existingUuid);
  });
});

describe("IdTranslator.slugFor", () => {
  it("returnerar slug för känd UUID", () => {
    const t = createIdTranslator();
    const uuid = t.toUuid("u-anna");
    expect(t.slugFor(uuid)).toBe("u-anna");
  });

  it("returnerar undefined för okänd UUID", () => {
    const t = createIdTranslator();
    expect(t.slugFor("01234567-89ab-cdef-0123-456789abcdef")).toBeUndefined();
  });
});

describe("translateIds", () => {
  it("översätter `id`-fält", () => {
    const t = createIdTranslator();
    const out = translateIds({ id: "u-anna", name: "Anna" }, t);
    expect(out.id).toBe(uuidv5("u-anna", AVA_NAMESPACE));
    expect(out.name).toBe("Anna");
  });

  it("översätter alla `*Id`-fält", () => {
    const t = createIdTranslator();
    const out = translateIds({
      id: "mc-1", matterId: "m-1", contactId: "c-1", organizationId: "org-1",
    }, t);
    expect(out.id).toBe(uuidv5("mc-1", AVA_NAMESPACE));
    expect(out.matterId).toBe(uuidv5("m-1", AVA_NAMESPACE));
    expect(out.contactId).toBe(uuidv5("c-1", AVA_NAMESPACE));
    expect(out.organizationId).toBe(uuidv5("org-1", AVA_NAMESPACE));
  });

  it("låter null/undefined Id-fält passera", () => {
    const t = createIdTranslator();
    const out = translateIds({ id: "x-1", motpartId: null, domstolId: undefined }, t);
    expect(out.motpartId).toBeNull();
    expect(out.domstolId).toBeUndefined();
  });

  it("rör inte fält som inte är Id-likt", () => {
    const t = createIdTranslator();
    const out = translateIds({ id: "x-1", matterNumber: "2026-0001", name: "X" }, t);
    expect(out.matterNumber).toBe("2026-0001");
    expect(out.name).toBe("X");
  });

  it("samma slug i flera fält → samma UUID", () => {
    const t = createIdTranslator();
    const a = translateIds({ id: "x-1", parentId: "shared" }, t);
    const b = translateIds({ id: "x-2", parentId: "shared" }, t);
    expect(a.parentId).toBe(b.parentId);
  });

  it("idempotent: redan UUID-formaterad input passerar oförändrad", () => {
    const t = createIdTranslator();
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    const out = translateIds({ id: uuid, matterId: uuid }, t);
    expect(out.id).toBe(uuid);
    expect(out.matterId).toBe(uuid);
  });
});

describe("translateSeed", () => {
  it("översätter Id-fält i alla rader av alla arrays", () => {
    const t = createIdTranslator();
    const seed = {
      users: [{ id: "u-anna", name: "Anna" }],
      matters: [{ id: "m-1", klientId: "c-1", title: "T" }],
      meta: { count: 2 }, // non-array key
    };
    const out = translateSeed(seed, t);
    expect(out.users[0]!.id).toBe(t.toUuid("u-anna"));
    expect(out.matters[0]!.id).toBe(t.toUuid("m-1"));
    expect(out.matters[0]!.klientId).toBe(t.toUuid("c-1"));
    expect(out.users[0]!.name).toBe("Anna");
    expect(out.meta).toEqual({ count: 2 });
  });

  it("bevarar samma UUID för samma slug över array-gränser", () => {
    const t = createIdTranslator();
    const seed = {
      users: [{ id: "u-anna" }],
      tasks: [{ id: "t-1", userId: "u-anna" }],
    };
    const out = translateSeed(seed, t);
    expect(out.tasks[0]!.userId).toBe(out.users[0]!.id);
  });
});
