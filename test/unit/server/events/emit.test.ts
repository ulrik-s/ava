import { describe, it, expect, vi } from "vitest-compat";
import { emit } from "@/lib/server/events/emit";
import { asId } from "@/lib/shared/schemas/ids";

function makeCtx() {
  const emitFn = vi.fn(async (input: unknown) => ({ id: "e1", ts: "now", ...input as object }));
  return {
    ctx: {
      user: { id: asId<"UserId">("anna") },
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
    await emit.matterCreated(ctx, { id: asId<"MatterId">("m1"), matterNumber: "2026-0001", title: "X" });
    const arg = emitFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("matter.created");
    expect(arg.matterId).toBe("m1");
    expect(arg.actor).toEqual({ kind: "user", id: "anna" });
    expect(arg.source).toBe("ui");
    expect(arg.payload).toEqual({ matterNumber: "2026-0001", title: "X" });
  });

  it("matterStatusChanged loggar from + to", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.matterStatusChanged(ctx, asId<"MatterId">("m1"), "ACTIVE", "ARCHIVED");
    const arg = emitFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("matter.status_changed");
    expect(arg.payload).toEqual({ from: "ACTIVE", to: "ARCHIVED" });
  });

  it("invoicePaymentReceived inkluderar amount", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.invoicePaymentReceived(ctx, asId<"InvoiceId">("inv-1"), asId<"MatterId">("m1"), 5000);
    const arg = emitFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("invoice.payment_received");
    expect(arg.payload).toEqual({ invoiceId: "inv-1", amount: 5000 });
  });

  it("timeEntryAdded inkluderar minutes och matterId", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.timeEntryAdded(ctx, { id: asId<"TimeEntryId">("t1"), matterId: asId<"MatterId">("m1"), minutes: 90 });
    const arg = emitFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("time-entry.added");
    expect(arg.matterId).toBe("m1");
    expect(arg.payload).toEqual({ entryId: "t1", minutes: 90 });
  });

  it("täcker alla emit-helpers (varje typ → ett event)", async () => {
    const { ctx, emitFn } = makeCtx();
    await emit.matterUpdated(ctx, asId<"MatterId">("m1"), { title: "ny" });
    await emit.matterArchived(ctx, asId<"MatterId">("m1"));
    await emit.contactCreated(ctx, { id: asId<"ContactId">("c1"), name: "Anna" });
    await emit.contactUpdated(ctx, asId<"ContactId">("c1"), { name: "Anna B" });
    await emit.contactDeleted(ctx, asId<"ContactId">("c1"));
    await emit.documentUploaded(ctx, { id: asId<"DocumentId">("d1"), fileName: "f.pdf", matterId: asId<"MatterId">("m1") });
    await emit.documentDeleted(ctx, { id: asId<"DocumentId">("d1"), matterId: asId<"MatterId">("m1") });
    await emit.documentAnalyzed(ctx, { id: asId<"DocumentId">("d1"), matterId: asId<"MatterId">("m1") }, { kind: "kontrakt" });
    await emit.invoiceCreated(ctx, { id: asId<"InvoiceId">("inv1"), matterId: asId<"MatterId">("m1"), amount: 1000 });
    await emit.invoiceSent(ctx, asId<"InvoiceId">("inv1"), asId<"MatterId">("m1"));
    await emit.invoiceWrittenOff(ctx, asId<"InvoiceId">("inv1"), asId<"MatterId">("m1"), 250);
    await emit.timeEntryUpdated(ctx, { id: asId<"TimeEntryId">("t1"), matterId: asId<"MatterId">("m1") });
    await emit.timeEntryDeleted(ctx, asId<"TimeEntryId">("t1"), asId<"MatterId">("m1"));
    await emit.kostnadsrakningGenerated(ctx, asId<"MatterId">("m1"), {
      documentId: asId<"DocumentId">("d1"), fileName: "kr.pdf", totalInclVat: 5000,
      huvudforhandlingMinutes: 120, organizationId: asId<"OrganizationId">("org-1"),
    });
    await emit.paymentDue(ctx, { invoiceId: "inv1" }, asId<"MatterId">("m1"));
    await emit.paymentOverdue(ctx, { invoiceId: "inv1" });
    await emit.userAction(ctx, { action: "login" });

    const types = emitFn.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(types).toEqual([
      "matter.updated", "matter.archived",
      "contact.created", "contact.updated", "contact.deleted",
      "document.uploaded", "document.deleted", "document.analyzed",
      "invoice.created", "invoice.sent", "invoice.written_off",
      "time-entry.updated", "time-entry.deleted",
      "kostnadsrakning.generated",
      "payment.due", "payment.overdue",
      "user.action",
    ]);
    // System-källan sätts för payment-scan-events; user-källan för övriga.
    const paymentDue = emitFn.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === "payment.due")![0] as Record<string, unknown>;
    expect(paymentDue.source).toBe("system");
    expect(paymentDue.actor).toEqual({ kind: "system", id: "payment-scan" });
  });

  it("emit-fel kraschar INTE caller (safeEmit sväljer)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      user: { id: asId<"UserId">("anna") },
      dataStore: {
        events: {
          emit: vi.fn(async () => { throw new Error("DB-fel"); }),
          query: vi.fn(),
          iterate: vi.fn(),
          onNewEvent: vi.fn(),
        },
      } as never,
    };
    await expect(emit.matterCreated(ctx, { id: asId<"MatterId">("m1"), matterNumber: "x", title: "y" })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled(); // oväntat fel → loggas
    errSpy.mockRestore();
  });

  it("ReadOnlyError sväljs tyst (väntat på demo-/git-backend, ingen log)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const readOnly = new Error('Demo-läget är read-only — kan inte köra "events.emit".');
    readOnly.name = "ReadOnlyError";
    const ctx = {
      user: { id: asId<"UserId">("anna") },
      dataStore: {
        events: {
          emit: vi.fn(async () => { throw readOnly; }),
          query: vi.fn(),
          iterate: vi.fn(),
          onNewEvent: vi.fn(),
        },
      } as never,
    };
    await expect(emit.matterCreated(ctx, { id: asId<"MatterId">("m1"), matterNumber: "x", title: "y" })).resolves.toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled(); // väntat → tyst
    errSpy.mockRestore();
  });
});
