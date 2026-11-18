/**
 * En flik som dör mitt i uppspelningen tappar ingen avvisad ändring (#1710, ADR 0037).
 *
 * Kön har tre poster och servern avvisar den andra. Fliken dör innan den
 * tredje fått svar: synken blir aldrig klar, så det som skulle ha sparats
 * "när reconcilen är klar" sparas aldrig. En ny flik startas från samma
 * IndexedDB. Den avvisade ändringen ska då finnas bland de avvisade
 * ändringarna och inte ligga kvar i kön, och invarianten "avvisades men syns
 * inte i avvisade ändringar" (`invariants.ts`) ska hålla.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { QUEUE_FORMAT_VERSION } from "@/lib/shared/sync/queue-format";
import { uuidv7 } from "@/lib/shared/uuid";
import { checkInvariants } from "./invariants";
import { SimBrowser, SimTab } from "./sim-browser";
import { SimNetwork } from "./sim-network";
import { FIRM_A, otherFirm, SimServer } from "./sync-world";

const tick = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** Vänta tills fliken dött (dess anrop får aldrig något svar). */
async function untilDead(tab: SimTab): Promise<void> {
  for (let i = 0; i < 100_000 && !tab.dead; i++) await tick();
  if (!tab.dead) throw new Error("fliken dog aldrig — nådde uppspelningen den sista posten?");
}

describe("avbrott mitt i uppspelningen (#1710)", () => {
  const prevIdb = Reflect.get(globalThis, "indexedDB");
  let server: SimServer;
  beforeAll(async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    server = await SimServer.start();
  });
  afterAll(async () => {
    Reflect.set(globalThis, "indexedDB", prevIdb);
    await server.handle.close();
  });

  it("fliken dör efter en avvisning → efter omstart finns ändringen bland de avvisade och inte i kön", async () => {
    const [admin] = FIRM_A.users;
    if (!admin) throw new Error("byrå A saknar administratör");
    const net = new SimNetwork(null);
    // Utan synklås: den döda fliken släpper aldrig sitt.
    const browser = new SimBrowser("w0", admin, "ADMIN", false);
    const tab = new SimTab("w0.0", browser, server, net);
    await tab.boot();
    expect(await tab.sync()).toBe("ok");

    // Kön: en kontakt, en ändring servern avvisar (den andra byråns rad), en kontakt till.
    const refused = uuidv7();
    await tab.api.contacts.create.mutate({ name: "Före", contactType: "PERSON" });
    await browser.queuePersistence().add({
      type: "row", mutationId: refused, entity: "contact", kind: "update", row: { id: otherFirm(FIRM_A).contact, name: "Kapad" },
      baseVersion: 1, enqueuedAt: Date.now(), format: QUEUE_FORMAT_VERSION,
    });
    await tab.api.contacts.create.mutate({ name: "Efter", contactType: "PERSON" });
    const queued = (await browser.storedQueue()).map((e) => e.mutationId);
    expect(queued).toHaveLength(3);
    expect(queued[1]).toBe(refused);

    // Pull + två poster får svar; den tredje postens anrop besvaras aldrig.
    tab.dieAfter = 3;
    void tab.sync();
    await untilDead(tab);
    expect(server.outcomes.get(refused)?.status).toBe("conflict");

    // Omstart från IndexedDB: avvisningen är sparad, och bara den sista posten är kvar i kön.
    const reborn = new SimTab("w0.1", browser, server, net);
    await reborn.boot();
    expect(await browser.rejectedIds()).toEqual(new Set([refused]));
    expect((await browser.storedQueue()).map((e) => e.mutationId)).toEqual([queued[2]]);
    expect(reborn.store.pendingEntries().map((e) => e.mutationId)).toEqual([queued[2]]);

    expect(await reborn.sync()).toBe("ok");
    expect(await browser.storedQueue()).toEqual([]);
    const verdict = await checkInvariants(server, [browser], [reborn], new Set([refused]));
    expect(verdict.violations).toEqual([]);
  }, 120_000);
});
