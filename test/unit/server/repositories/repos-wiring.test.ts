/**
 * Repos-wiring (ADR 0020, #409 fas 2b) — `buildContext` exponerar `ctx.repos`
 * (in-memory default ovanpå dataStore) och `ctx.repos.transaction` ärver
 * store:ns snapshot/rollback. Bevisar att sömmen är tillgänglig i varje
 * tRPC-context utan att någon router migrerats än (samexistens).
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { uuidv7 } from "@/lib/shared/uuid";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inv = (id: string, matterId: string): any => ({
  id, matterId, amount: 1_000, status: "DRAFT", invoiceType: "STANDARD",
  invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
});

function ctxOver(seed: Record<string, unknown[]>) {
  const ds = new DemoDataStore(seed as never, async () => {});
  return buildContext({ dataStore: ds, ports: noopPorts, principal: null });
}

describe("buildContext — repos-wiring", () => {
  it("exponerar ctx.repos.invoices (in-memory) ovanpå dataStore", async () => {
    const id = uuidv7();
    const matterId = uuidv7();
    const ctx = ctxOver({ invoices: [], payments: [], writeOffs: [] });
    expect(ctx.repos).toBeDefined();
    const created = await ctx.repos.invoices.create(inv(id, matterId));
    expect(created.amount).toBe(1_000);
    expect(await ctx.repos.invoices.getById(id)).toMatchObject({ id });
    expect((await ctx.repos.invoices.listByMatter(matterId)).map((i) => i.id)).toContain(id);
  });

  it("ctx.repos.transaction rullar tillbaka vid fel (ärver store-snapshot)", async () => {
    const id = uuidv7();
    const ctx = ctxOver({ invoices: [], payments: [], writeOffs: [] });
    await expect(
      ctx.repos.transaction(async (tx) => {
        await tx.invoices.create(inv(id, uuidv7()));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await ctx.repos.invoices.getById(id)).toBeNull(); // rullades tillbaka
  });

  it("ctx.repos.transaction commit:ar vid framgång", async () => {
    const id = uuidv7();
    const ctx = ctxOver({ invoices: [], payments: [], writeOffs: [] });
    await ctx.repos.transaction(async (tx) => {
      await tx.invoices.create(inv(id, uuidv7()));
    });
    expect(await ctx.repos.invoices.getById(id)).toMatchObject({ id });
  });
});
