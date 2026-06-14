/**
 * Kloss 2 — `buildContext`.
 *
 * Den enda platsen där en `Context` sätts ihop. Både Git-backendens
 * in-process-länk och en framtida server-`createContext` bygger sin Context
 * härigenom → DRY-shape oavsett backend.
 */

import { describe, it, expect } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import type { IPorts } from "@/lib/server/ports";

const fakeStore = { marker: "store" } as unknown as IDataStore;
const fakePorts = { marker: "ports" } as unknown as IPorts;
const principal: Principal = {
  id: "u-anna", email: "a@b.se", name: "Anna", role: "ADMIN", organizationId: "org-1",
};

describe("buildContext", () => {
  it("mappar principal → ctx.user och släpper igenom dataStore + ports", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal });
    expect(ctx.dataStore).toBe(fakeStore);
    expect(ctx.ports).toBe(fakePorts);
    expect(ctx.user).toBe(principal);
  });

  it("principal=null → ctx.user=null (anonym/publik)", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal: null });
    expect(ctx.user).toBeNull();
  });

  it("returnerar exakt Context-formen (inga extra fält)", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal });
    expect(Object.keys(ctx).sort()).toEqual(["dataStore", "ports", "user"]);
  });
});
