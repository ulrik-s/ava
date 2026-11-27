/**
 * Synkversioner och karantän (#1772):
 *   - passar inte klientens och serverns synkprotokoll skickas inga ändringar —
 *     de ligger kvar i kön, cursorn flyttas inte, och användaren får ett besked
 *     (servern äldre efter en rollback, eller klienten för gammal),
 *   - en post som servern vägrar från den här användaren (köad av en annan på
 *     samma dator) hamnar bland de avvisade ändringarna med "Försök igen", och
 *     kön fortsätter i stället för att stanna bakom en inloggning som inte hjälper.
 */
import { describe, expect, it } from "vitest-compat";
import { InMemoryCursorStore } from "@/lib/client/local-store/cursor-store";
import { InMemoryMutationQueuePersistence, MutationQueue } from "@/lib/client/local-store/mutation-queue";
import { ReconcileEngine } from "@/lib/client/local-store/reconcile-engine";
import type { ProcedureReplayResult, PulledChange, PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import { type ServerSyncInfo, SYNC_PROTOCOL_VERSION } from "@/lib/shared/sync/protocol";

const ROW: PulledChange = { entity: "contact", row: { id: "c1", name: "Ny" } };

class Transport implements SyncTransport {
  server: ServerSyncInfo | undefined = undefined;
  pushed: string[] = [];
  refuse = new Set<string>();
  pull(): Promise<PullResult> {
    return Promise.resolve({ changes: [ROW], cursor: 9, ...(this.server ? { server: this.server } : {}) });
  }
  rows(): Promise<PulledChange[]> { return Promise.resolve([]); }
  push(m: { mutationId: string; row: Record<string, unknown> }): Promise<PushResult> {
    this.pushed.push(m.mutationId);
    if (this.refuse.has(m.mutationId)) {
      return Promise.reject(Object.assign(new Error("Ändringen köades av en annan användare."), { name: "TRPCClientError", data: { code: "FORBIDDEN", httpStatus: 403, syncRefusal: "foreign-entry" } }));
    }
    return Promise.resolve({ status: "accepted", row: m.row });
  }
  pushProcedure(): Promise<ProcedureReplayResult> { return Promise.resolve({ status: "accepted", rows: [] }); }
}

async function harness() {
  const transport = new Transport();
  const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
  const cursor = new InMemoryCursorStore();
  const applied: string[] = [];
  const engine = new ReconcileEngine({ transport, queue, cursor, apply: (_e, row) => { applied.push(String(row.id)); } });
  const row = (id: string) => queue.enqueue({ entity: "timeEntry", kind: "create", row: { id } }, { mutationId: id });
  return { transport, queue, cursor, engine, applied, row };
}

const server = (protocol: number, minClient = 1): ServerSyncInfo => ({ protocol, minClient, release: "v9" });

describe("ReconcileEngine — synkversionerna (#1772)", () => {
  it("passar versionerna (eller saknar servern fältet) spelas kön upp som vanligt", async () => {
    for (const s of [undefined, server(SYNC_PROTOCOL_VERSION)]) {
      const h = await harness();
      h.transport.server = s;
      await h.row("a");
      const res = await h.engine.reconcile();
      expect(res.incompatible).toBeUndefined();
      expect(h.transport.pushed).toEqual(["a"]);
      expect(await h.cursor.get()).toBe(9);
    }
  });

  it("servern är äldre (rollback): inget skickas, kön och cursorn står kvar, pullen tillämpas", async () => {
    const h = await harness();
    h.transport.server = server(SYNC_PROTOCOL_VERSION - 1, 0);
    await h.row("a");
    const res = await h.engine.reconcile();
    expect(res.incompatible).toMatch(/^Servern kör en äldre version av AVA/);
    expect(h.transport.pushed).toEqual([]);
    expect(h.queue.pending().map((m) => m.mutationId)).toEqual(["a"]);
    expect(await h.cursor.get()).toBe(0);
    expect(h.applied).toEqual(["c1"]);
    expect(res.blocked).toBeNull();
  });

  it("klienten är för gammal: besked om att ladda om", async () => {
    const h = await harness();
    h.transport.server = server(SYNC_PROTOCOL_VERSION + 1, SYNC_PROTOCOL_VERSION + 1);
    const res = await h.engine.reconcile();
    expect(res.incompatible).toMatch(/för gammal för servern. Ladda om sidan/);
  });
});

describe("ReconcileEngine — karantän för en annan användares post (#1772)", () => {
  it("posten hamnar bland de avvisade med Försök igen; kön fortsätter", async () => {
    const h = await harness();
    await h.row("a");
    await h.row("b");
    h.transport.refuse.add("a");
    const res = await h.engine.reconcile();
    expect(res.conflicts).toEqual([expect.objectContaining({ mutation: expect.objectContaining({ mutationId: "a" }), reason: "Ändringen köades av en annan användare.", retryable: true })]);
    expect(h.transport.pushed).toEqual(["a", "b"]);
    expect(res.blocked).toBeNull();
    expect(h.queue.pending()).toEqual([]);
  });
});
