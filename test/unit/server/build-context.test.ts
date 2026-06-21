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
import { DEMO_CAPABILITIES } from "@/lib/shared/capabilities";

const fakeEvents = { marker: "events" };
const fakeStore = { marker: "store", events: fakeEvents } as unknown as IDataStore;
const fakePorts = { marker: "ports" } as unknown as IPorts;
const principal: Principal = {
  id: "u-anna", email: "a@b.se", name: "Anna", role: "ADMIN", organizationId: "org-1",
};

describe("buildContext", () => {
  it("mappar principal → ctx.user och wirar dataStore.events + ports", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal });
    // ctx.dataStore är medvetet smal (bara `events`) — ADR 0020.
    expect(ctx.dataStore.events).toBe(fakeEvents);
    expect(ctx.ports).toBe(fakePorts);
    expect(ctx.user).toBe(principal);
    expect(ctx.repos).toBeDefined(); // ADR 0020 — default in-memory-repos
  });

  it("principal=null → ctx.user=null (anonym/publik)", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal: null });
    expect(ctx.user).toBeNull();
  });

  it("returnerar exakt Context-formen (inga extra fält)", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal });
    expect(Object.keys(ctx).sort()).toEqual(["capabilities", "dataStore", "ports", "repos", "user"]);
  });

  it("defaultar capabilities till demo-baslinjen (ADR 0027)", () => {
    const ctx = buildContext({ dataStore: fakeStore, ports: fakePorts, principal });
    expect(ctx.capabilities).toEqual(DEMO_CAPABILITIES);
  });
});
