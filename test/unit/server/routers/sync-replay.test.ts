/**
 * `sync.replay` (#1265) utan server: in-process-vägen (demo/git) har ingen
 * `ctx.replayProcedure` → NOT_IMPLEMENTED, i stället för att tyst godta.
 */
import { describe, expect, it } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { MAX_PROCEDURE_TOUCHES } from "@/lib/server/data-store/in-memory/procedure-touches";
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

  const callWith = (n: number) => {
    const ds = new DemoDataStore({});
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() }));
    const touches = Array.from({ length: n }, () => ({ entity: "timeEntry", id: uuidv7() }));
    return caller.sync.replay({ type: "procedure", mutationId: uuidv7(), path: "timeEntry.create", input: {}, codeVersion: "t", touches, enqueuedAt: 0 });
  };

  it("indatat valideras: fler touches än klientens kö tillåter avvisas", async () => {
    await expect(callWith(MAX_PROCEDURE_TOUCHES + 1)).rejects.toThrow(/too_big|Too big|10000/i);
  });

  it("fler än 100 touches tas emot (#1674): en debitering av ett stort ärende avvisades", async () => {
    // Valideringen släpper igenom; det som stoppar här är att in-process-vägen saknar omkörning.
    await expect(callWith(101)).rejects.toThrow(/Omkörning av köade anrop finns inte/);
  });
});
