/**
 * Köposter bär sin ägare (#1347): servern kör alltid som den inloggade och
 * vägrar en post som en annan användare köade — A:s osynkade ändringar sparas
 * aldrig i B:s namn. Poster utan ägare (köade före #1347) tas emot som förut.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { FOREIGN_QUEUE_ENTRY_MESSAGE } from "@/lib/server/routers/sync";
import type { SyncStore } from "@/lib/server/sync/sync-store";
import { SYNC_PROTOCOL_VERSION } from "@/lib/shared/sync/protocol";
import { SyncRefusal } from "@/lib/shared/sync/sync-error";
import { uuidv7 } from "@/lib/shared/uuid";

function caller() {
  const ds = new DemoDataStore({});
  const principal = new GitAuthProvider().getPrincipal();
  const push = vi.fn(async (_pusher: unknown, _m: unknown) => ({ status: "accepted" as const, row: {} }));
  const sync: SyncStore = { push, pull: async () => ({ changes: [], cursor: 0 }), rows: async () => [] };
  const replayProcedure = vi.fn(async (_call: unknown) => ({ status: "accepted" as const, rows: [] }));
  const ctx = { ...buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal }), sync, replayProcedure };
  return { call: appRouter.createCaller(ctx), principal, push, replayProcedure };
}

const procedure = (owner?: { principalId: string; organizationId: string }) => ({
  type: "procedure" as const, mutationId: uuidv7(), path: "timeEntry.create", input: {}, codeVersion: "t", touches: [], enqueuedAt: 0,
  ...(owner ? { owner } : {}),
});
const row = (owner?: { principalId: string; organizationId: string }) => ({
  mutationId: uuidv7(), entity: "contact", kind: "create" as const, row: { id: uuidv7() }, enqueuedAt: 0, ...(owner ? { owner } : {}),
});

describe("sync.replay / sync.push — ägaren", () => {
  it("en annan användares post vägras med FORBIDDEN och en orsak — klienten lägger den i karantän (#1772), inget 401", async () => {
    const { call, push, replayProcedure } = caller();
    const other = { principalId: "u-annan", organizationId: "o" };
    await expect(call.sync.replay(procedure(other))).rejects.toMatchObject({ code: "FORBIDDEN", message: FOREIGN_QUEUE_ENTRY_MESSAGE });
    const err: unknown = await call.sync.push(row(other)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(SyncRefusal);
    expect(replayProcedure).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("pullen säger serverns synkversion (#1772)", async () => {
    const { call } = caller();
    const res = await call.sync.pull({ sinceCursor: 0 });
    expect(res.server).toMatchObject({ protocol: SYNC_PROTOCOL_VERSION, minClient: expect.any(Number) });
  });

  it("den inloggades egen post — och en post utan ägare — körs, utan ägarfältet", async () => {
    const { call, principal, push, replayProcedure } = caller();
    const mine = { principalId: principal.id, organizationId: principal.organizationId };
    await call.sync.replay(procedure(mine));
    await call.sync.replay(procedure());
    expect(replayProcedure).toHaveBeenCalledTimes(2);
    expect(replayProcedure.mock.calls[0]?.[0]).not.toHaveProperty("owner");
    await call.sync.push(row(mine));
    expect(push.mock.calls[0]?.[1]).not.toHaveProperty("owner");
  });
});
