/**
 * Ärendets taxeflaggor (#1919): `taxaHasFTax` har kolumnens standardvärde
 * `true` överallt och är aldrig null (kolumnen är `NOT NULL DEFAULT true`,
 * migration 0051). `isTaxeArende` får sitt standardvärde `false` på samma sätt.
 * Databasens standardvärde gäller inte i minnesstoren, så `matter.create`
 * sätter båda. Postgres-sidan prövas i `repositories/matter-repository.test.ts`.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { matterSchema } from "@/lib/shared/schemas/matter";
import { buildSeed } from "../../../../tooling/scripts/seed-data";

const ORG = "org-a";

function makeCaller(matters: Record<string, unknown>[] = []) {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "X" }],
    users: [{ id: "user-1", organizationId: ORG, email: "a@b.com", name: "Test", role: "LAWYER" }],
    matters, contacts: [], matterContacts: [],
  }, async () => { /* skrivbar */ });
  const principal = {
    id: asId<"UserId">("user-1"), email: "a@b.com", name: "Test", role: "LAWYER" as const,
    organizationId: asId<"OrganizationId">(ORG),
  };
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal }));
  return { caller: caller.matter };
}

describe("matterSchema.taxaHasFTax (#1919)", () => {
  const field = matterSchema.shape.taxaHasFTax;

  it("saknas fältet blir det true, som kolumnens standardvärde", () => {
    expect(field.parse(undefined)).toBe(true);
  });

  it("null avvisas: fältet är aldrig null", () => {
    expect(field.safeParse(null).success).toBe(false);
  });

  it("ett angivet värde gäller", () => {
    expect(field.parse(false)).toBe(false);
  });
});

describe("matter.create — taxeflaggorna (#1919)", () => {
  it("utan flaggorna: isTaxeArende false och taxaHasFTax true i minnesstoren", async () => {
    const { caller } = makeCaller();
    const created = await caller.create({ title: "Nytt" });
    expect(created).toMatchObject({ isTaxeArende: false, taxaHasFTax: true });
    expect(await caller.getById({ id: created.id })).toMatchObject({ isTaxeArende: false, taxaHasFTax: true });
  });

  it("angivna flaggor sparas", async () => {
    const { caller } = makeCaller();
    const created = await caller.create({ title: "Taxa", isTaxeArende: true, taxaHasFTax: false });
    expect(created).toMatchObject({ isTaxeArende: true, taxaHasFTax: false });
  });

  it("taxaHasFTax: null avvisas och inget ärende skapas", async () => {
    const { caller } = makeCaller();
    // null släpps inte igenom av typerna; det är zod-kontrollen vid körning som prövas.
    await expect(caller.create({ title: "T", taxaHasFTax: null } as never)).rejects.toThrow();
    expect((await caller.list({})).total).toBe(0);
  });
});

describe("matter.update — taxaHasFTax (#1919)", () => {
  const existing = { id: "m-1", organizationId: ORG, matterNumber: "2026-0001", title: "T", status: "ACTIVE", taxaHasFTax: false, createdAt: new Date() };

  const read = async (caller: ReturnType<typeof makeCaller>["caller"]) => caller.getById({ id: "m-1" });

  it("utelämnat lämnar fältet orört", async () => {
    const { caller } = makeCaller([{ ...existing }]);
    await caller.update({ id: "m-1", title: "Ny titel" });
    expect(await read(caller)).toMatchObject({ title: "Ny titel", taxaHasFTax: false });
  });

  it("ett nytt värde sparas", async () => {
    const { caller } = makeCaller([{ ...existing }]);
    await caller.update({ id: "m-1", taxaHasFTax: true });
    expect((await read(caller)).taxaHasFTax).toBe(true);
  });

  it("null avvisas och fältet är orört", async () => {
    const { caller } = makeCaller([{ ...existing }]);
    // Som ovan: null prövas mot zod vid körning, förbi typerna.
    await expect(caller.update({ id: "m-1", taxaHasFTax: null } as never)).rejects.toThrow();
    expect((await read(caller)).taxaHasFTax).toBe(false);
  });
});

describe("seeden — taxaHasFTax (#1919)", () => {
  it("varje ärende har ett booleskt taxaHasFTax, true när seeden inte anger det", () => {
    const { matters } = buildSeed();
    expect(matters.length).toBeGreaterThan(0);
    for (const m of matters) expect(typeof m.taxaHasFTax).toBe("boolean");
    // m-016 anger fältet; ett ärende utan det får standardvärdet.
    const unset = matters.filter((m) => m.id !== "m-016-brottmal-rh");
    expect(unset.every((m) => m.taxaHasFTax === true)).toBe(true);
  });
});
