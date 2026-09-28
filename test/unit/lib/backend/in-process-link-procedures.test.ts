/**
 * `inProcessLink` med procedur-inspelning (#1265, ADR 0037).
 *
 * - En köbar mutation (tidsposter) körs via inspelaren, med ett klient-
 *   genererat id i input — så att servern kan köra om exakt samma anrop.
 * - Övriga mutationer och alla frågor går direkt, som förut.
 * - En köbar procedur körs exklusivt: dess lokala skrivningar ska inte kunna
 *   blandas ihop med en samtidig mutations (de attribueras till anropet).
 *   Övriga mutationer överlappar varandra som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { inProcessLink, type ProcedureRecorder } from "@/lib/client/demo/in-process-link";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { isUuid } from "@/lib/shared/uuid";

function ctx() {
  const ds = new DemoDataStore({});
  return buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() });
}

type Op = { type: "query" | "mutation"; path: string; input: unknown };

/** En inspelare som minns anropen och kör dem. */
function spyRecorder(): { recorder: ProcedureRecorder; calls: Array<{ path: string; input: unknown }> } {
  const calls: Array<{ path: string; input: unknown }> = [];
  const recorder: ProcedureRecorder = async (call, exec) => { calls.push(call); return exec(); };
  return { recorder, calls };
}

/** Kör en operation direkt genom länken (utan tRPC-klient) och vänta in svaret. */
function invoke(link: ReturnType<typeof inProcessLink>, op: Op): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obs = (link as any)({})({ op: { ...op, id: 0, context: {} }, next: () => {} });
  return new Promise((resolve, reject) => obs.subscribe({ next: (v: { result: { data: unknown } }) => resolve(v.result.data), error: reject }));
}

describe("inProcessLink — köbara procedurer", () => {
  it("köbar mutation → via inspelaren, med klient-genererat id i input", async () => {
    const { recorder, calls } = spyRecorder();
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    await invoke(link, { type: "mutation", path: "timeEntry.create", input: { matterId: "m", date: "2026-01-01", minutes: 5, description: "x" } })
      .catch(() => undefined); // proceduren själv kan fela i den tomma storen — det är inspelningen som testas
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("timeEntry.create");
    expect(isUuid((calls[0]!.input as { id: string }).id)).toBe(true);
  });

  it("proceduren körs med SAMMA input som spelas in (id:t följer med)", async () => {
    let executedWith: unknown;
    const recorder: ProcedureRecorder = async (call, exec) => { executedWith = call.input; return exec(); };
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    await invoke(link, { type: "mutation", path: "timeEntry.delete", input: { id: "0190a1b2-0000-7000-8000-000000000001" } })
      .catch(() => undefined);
    expect(executedWith).toEqual({ id: "0190a1b2-0000-7000-8000-000000000001" });
  });

  it("icke-köbar mutation och frågor går förbi inspelaren", async () => {
    const { recorder, calls } = spyRecorder();
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    await invoke(link, { type: "query", path: "timeEntry.list", input: {} }).catch(() => undefined);
    await invoke(link, { type: "mutation", path: "contacts.create", input: { name: "x", contactType: "PERSON" } }).catch(() => undefined);
    expect(calls).toHaveLength(0);
  });

  it("utan inspelare (demo) körs allt direkt", async () => {
    const link = inProcessLink(ctx());
    await expect(invoke(link, { type: "mutation", path: "doesNot.exist", input: {} })).rejects.toThrow(/No procedure/i);
  });

  it("en vanlig mutation väntar tills en pågående köbar procedur är klar", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const recorder: ProcedureRecorder = async (_call, exec) => { await gate; return exec(); };
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    const events: string[] = [];
    const first = invoke(link, { type: "mutation", path: "timeEntry.delete", input: { id: "x" } })
      .catch(() => undefined).then(() => events.push("första klar"));
    const second = invoke(link, { type: "mutation", path: "doesNot.exist", input: {} })
      .catch(() => events.push("andra klar"));
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["första klar", "andra klar"]);
  });

  it("vanliga mutationer blockerar inte varandra (inget dödläge om en väntar på en annan)", async () => {
    const { recorder, calls } = spyRecorder();
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    const results = await Promise.allSettled([
      invoke(link, { type: "mutation", path: "doesNot.exist", input: {} }),
      invoke(link, { type: "mutation", path: "doesNot.existEither", input: {} }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toHaveLength(0);
  });

  it("frågor väntar inte på en pågående mutation", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const recorder: ProcedureRecorder = async (_call, exec) => { await gate; return exec(); };
    const link = inProcessLink(ctx(), { recordProcedure: recorder });
    const pendingMutation = invoke(link, { type: "mutation", path: "timeEntry.delete", input: { id: "x" } }).catch(() => undefined);
    await expect(invoke(link, { type: "query", path: "doesNot.exist", input: {} })).rejects.toThrow(/No procedure/i);
    release();
    await pendingMutation;
  });
});
