/**
 * `sync.replay` (#1265) utan server: in-process-vägen (demo/git) har ingen
 * `ctx.replayProcedure` → NOT_IMPLEMENTED, i stället för att tyst godta.
 */
import { describe, expect, it } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";

describe("sync.replay utan server", () => {
  it("NOT_IMPLEMENTED", async () => {
    const ds = new DemoDataStore({});
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() }));
    await expect(caller.sync.replay({
      type: "procedure", mutationId: uuidv7(), path: "timeEntry.create", input: {}, codeVersion: "t", touches: [], enqueuedAt: 0,
    })).rejects.toThrow(/Omkörning av köade anrop finns inte/);
  });

  it("indatat valideras: för många touches avvisas", async () => {
    const ds = new DemoDataStore({});
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() }));
    const touches = Array.from({ length: 101 }, () => ({ entity: "timeEntry", id: uuidv7() }));
    await expect(caller.sync.replay({
      type: "procedure", mutationId: uuidv7(), path: "timeEntry.create", input: {}, codeVersion: "t", touches, enqueuedAt: 0,
    })).rejects.toThrow();
  });
});
