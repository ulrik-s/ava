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
  it("en annan användares post vägras (UNAUTHORIZED: kön stannar, inget avvisas)", async () => {
    const { call, push, replayProcedure } = caller();
    const other = { principalId: "u-annan", organizationId: "o" };
    await expect(call.sync.replay(procedure(other))).rejects.toMatchObject({ code: "UNAUTHORIZED", message: FOREIGN_QUEUE_ENTRY_MESSAGE });
    await expect(call.sync.push(row(other))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(replayProcedure).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
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
