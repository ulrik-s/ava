import { describe, it, expect, vi } from "vitest";
import { emit } from "@/lib/server/events/emit";

function makeCtx() {
  const emitFn = vi.fn(async (input: unknown) => ({ id: "e1", ts: "now", ...input as object }));
  return {
    ctx: {
      user: { id: "anna" },
      dataStore: {
        events: { emit: emitFn, query: vi.fn(), iterate: vi.fn(), onNewEvent: vi.fn() },
      } as never,
    },
    emitFn,
  };
}

describe("emit-helpers", () => {
  it("matterCreated skickar rätt payload + matterId", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.matterCreated(ctx, { id: "m1", matterNumber: "2026-0001", title: "X" });
    const arg = emitFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe("matter.created");
    expect(arg.matterId).toBe("m1");
    expect(arg.actor).toEqual({ kind: "user", id: "anna" });
    expect(arg.source).toBe("ui");
    expect(arg.payload).toEqual({ matterNumber: "2026-0001", title: "X" });
  });

  it("matterStatusChanged loggar from + to", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.matterStatusChanged(ctx, "m1", "ACTIVE", "ARCHIVED");
    const arg = emitFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe("matter.status_changed");
    expect(arg.payload).toEqual({ from: "ACTIVE", to: "ARCHIVED" });
  });

  it("invoicePaymentReceived inkluderar amount", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.invoicePaymentReceived(ctx, "inv-1", "m1", 5000);
    const arg = emitFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe("invoice.payment_received");
    expect(arg.payload).toEqual({ invoiceId: "inv-1", amount: 5000 });
  });

  it("timeEntryAdded inkluderar minutes och matterId", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.timeEntryAdded(ctx, { id: "t1", matterId: "m1", minutes: 90 });
    const arg = emitFn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.type).toBe("time-entry.added");
    expect(arg.matterId).toBe("m1");
    expect(arg.payload).toEqual({ entryId: "t1", minutes: 90 });
  });

  it("emit-fel kraschar INTE caller (safeEmit sväljer)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      user: { id: "anna" },
      dataStore: {
        events: {
          emit: vi.fn(async () => { throw new Error("DB-fel"); }),
          query: vi.fn(),
          iterate: vi.fn(),
          onNewEvent: vi.fn(),
        },
      } as never,
    };
    await expect(emit.matterCreated(ctx, { id: "m1", matterNumber: "x", title: "y" })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled(); // oväntat fel → loggas
    errSpy.mockRestore();
  });

  it("ReadOnlyError sväljs tyst (väntat på demo-/git-backend, ingen log)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const readOnly = new Error('Demo-läget är read-only — kan inte köra "events.emit".');
    readOnly.name = "ReadOnlyError";
    const ctx = {
      user: { id: "anna" },
      dataStore: {
        events: {
          emit: vi.fn(async () => { throw readOnly; }),
          query: vi.fn(),
          iterate: vi.fn(),
          onNewEvent: vi.fn(),
        },
      } as never,
    };
    await expect(emit.matterCreated(ctx, { id: "m1", matterNumber: "x", title: "y" })).resolves.toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled(); // väntat → tyst
    errSpy.mockRestore();
  });
});
