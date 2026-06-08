/**
 * Tester för `DemoDataStore.transaction()` — in-memory-motsvarigheten till
 * Prisma's `$transaction`. Krav:
 *   - Callbacken får ett `tx` med samma (plural-namngivna) delegates.
 *   - Mutationer inuti committas till source-arrayerna VID SUCCESS.
 *   - Write-back-event:en buffras och flushas FÖRST när callbacken lyckas
 *     (annars skulle en halv/felad transaktion skriva filer till git-db:n).
 *   - Kastar callbacken → rollback: source-arrayerna oförändrade OCH inga
 *     write-back-event emitteras.
 */

import { describe, it, expect } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

function makeStore() {
  const source: DemoSource = {
    invoices: [{ id: "inv1", amount: 1000, status: "SENT", matterId: "m1" }],
    payments: [],
  };
  const events: MutationEvent<Record<string, unknown>>[] = [];
  const ds = new DemoDataStore(source, (e) => { events.push(e); });
  return { ds, source, events };
}

describe("DemoDataStore.transaction", () => {
  it("committar mutationer + flushar write-back vid success", async () => {
    const { ds, source, events } = makeStore();

    const result = await ds.transaction(async (tx) => {
      const payment = await tx.payments.create({
        data: { id: "pay1", invoiceId: "inv1", amount: 1000 },
      } as never);
      await tx.invoices.update({
        where: { id: "inv1" },
        data: { status: "PAID" },
      } as never);
      return payment;
    });

    expect((result as { id: string }).id).toBe("pay1");
    // Source uppdaterad
    expect(source.payments).toHaveLength(1);
    expect((source.invoices![0] as { status: string }).status).toBe("PAID");
    // Write-back flushad EN gång per mutation, i ordning
    expect(events.map((e) => `${e.entity}:${e.kind}`)).toEqual([
      "payment:create",
      "invoice:update",
    ]);
  });

  it("rollback vid throw: ingen källändring, inga write-back-event", async () => {
    const { ds, source, events } = makeStore();

    await expect(
      ds.transaction(async (tx) => {
        await tx.payments.create({ data: { id: "pay1", invoiceId: "inv1", amount: 1000 } } as never);
        await tx.invoices.update({ where: { id: "inv1" }, data: { status: "PAID" } } as never);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Rollback: payment borttagen, invoice tillbaka till SENT
    expect(source.payments).toHaveLength(0);
    expect((source.invoices![0] as { status: string }).status).toBe("SENT");
    // Inga write-back-event flushade
    expect(events).toHaveLength(0);
  });

  it("write-back buffras (flushas inte mitt i transaktionen)", async () => {
    const { ds, events } = makeStore();
    await ds.transaction(async (tx) => {
      await tx.payments.create({ data: { id: "pay1", invoiceId: "inv1", amount: 1 } } as never);
      // Mitt i transaktionen: ännu inget flushat
      expect(events).toHaveLength(0);
      return null;
    });
    // Efter commit: flushat
    expect(events).toHaveLength(1);
  });
});
