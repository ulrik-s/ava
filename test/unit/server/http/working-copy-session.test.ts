/**
 * Enhetstester för `makeWorkingCopySessionOpener` (#83, ADR 0013 beslut A).
 * Verifierar per-request-flödet med injicerade fakes (ingen riktig git):
 *   - sync körs FÖRE hydrering (open)
 *   - query (GET) → ingen commit/push
 *   - mutation (POST) med ändringar → commit + push
 *   - mutation (POST) utan ändringar → ingen commit (inga tomma commits)
 */
import { describe, it, expect, vi } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { makeWorkingCopySessionOpener } from "@/lib/server/http/working-copy-session";
import type { ServerWorkingCopy } from "@/lib/server/local-first/server-working-copy";
import type { Context } from "@/lib/server/trpc-core";

const PRINCIPAL: Principal = {
  id: "p-1", email: "advokat@byra.se", name: "Ada", role: "LAWYER", organizationId: "org-1",
};

interface Fakes {
  events: string[];
  commit: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  context: Context;
}

function makeOpener(hasChanges: boolean) {
  const events: string[] = [];
  const commit = vi.fn(async () => { events.push("commit"); return { hash: "h", message: "m" }; });
  const push = vi.fn(async () => { events.push("push"); return { ok: true }; });
  const context = { user: PRINCIPAL } as unknown as Context;
  const wc = {
    context,
    commit,
    gitOps: { hasChanges: async () => hasChanges, push },
  } as unknown as ServerWorkingCopy;

  const open = vi.fn(async (_dir: string, _p: Principal) => { events.push("open"); return wc; });
  const sync = vi.fn(async (_dir: string, _p: Principal) => { events.push("sync"); });

  const openSession = makeWorkingCopySessionOpener({ dir: "/wc", open, sync });
  const fakes: Fakes = { events, commit, push, context };
  return { openSession, fakes };
}

const get = () => new Request("http://x/api/trpc/user.current");
const post = () => new Request("http://x/api/trpc/timeEntry.create", { method: "POST" });

describe("makeWorkingCopySessionOpener", () => {
  it("synkar FÖRE hydrering och returnerar working-copy:ns context", async () => {
    const { openSession, fakes } = makeOpener(true);
    const session = await openSession(PRINCIPAL);
    expect(fakes.events).toEqual(["sync", "open"]);
    expect(session.context).toBe(fakes.context);
  });

  it("query (GET) → varken commit eller push", async () => {
    const { openSession, fakes } = makeOpener(true);
    const session = await openSession(PRINCIPAL);
    await session.finalize(get());
    expect(fakes.commit).not.toHaveBeenCalled();
    expect(fakes.push).not.toHaveBeenCalled();
  });

  it("mutation (POST) med ändringar → commit + push (i ordning)", async () => {
    const { openSession, fakes } = makeOpener(true);
    const session = await openSession(PRINCIPAL);
    await session.finalize(post());
    expect(fakes.commit).toHaveBeenCalledTimes(1);
    expect(fakes.push).toHaveBeenCalledTimes(1);
    expect(fakes.events).toEqual(["sync", "open", "commit", "push"]);
  });

  it("mutation (POST) utan ändringar → ingen commit (inga tomma commits)", async () => {
    const { openSession, fakes } = makeOpener(false);
    const session = await openSession(PRINCIPAL);
    await session.finalize(post());
    expect(fakes.commit).not.toHaveBeenCalled();
    expect(fakes.push).not.toHaveBeenCalled();
  });
});
