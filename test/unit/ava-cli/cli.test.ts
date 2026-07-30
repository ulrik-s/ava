/**
 * Ren argument-parsing + körning för `ava`-CLI:t. Fejkar callern så inga
 * server-/store-beroenden behövs.
 */

import { describe, it, expect } from "vitest-compat";
import type { AvaCaller } from "../../../tooling/ava-cli/caller";
import { parseArgs, runParsed, USAGE, type Mode, type RunDeps } from "../../../tooling/ava-cli/cli";
import type { ProcedureInfo } from "../../../tooling/ava-cli/introspect";

const PROCS: ProcedureInfo[] = [
  { path: "invoice.list", type: "query", inputSchema: null },
  { path: "invoice.createRadgivning", type: "mutation", inputSchema: null },
];

function fakeDeps(overrides: Partial<RunDeps> = {}): { deps: RunDeps; calls: { path: string; input: unknown; mode: Mode }[] } {
  const calls: { path: string; input: unknown; mode: Mode }[] = [];
  const openCaller = (mode: Mode): AvaCaller => ({
    invoke: (path, input) => {
      calls.push({ path, input, mode });
      return Promise.resolve({ echoed: input });
    },
    close: () => Promise.resolve(),
  });
  return { deps: { procedures: PROCS, openCaller, ...overrides }, calls };
}

describe("parseArgs", () => {
  it("tom input → help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("describe med och utan prefix", () => {
    expect(parseArgs(["describe"])).toEqual({ kind: "describe", prefix: null });
    expect(parseArgs(["describe", "invoice"])).toEqual({ kind: "describe", prefix: "invoice" });
  });

  it("call: default local, --input som JSON, --remote", () => {
    expect(parseArgs(["invoice.list"])).toEqual({ kind: "call", path: "invoice.list", input: {}, mode: "local" });
    expect(parseArgs(["invoice.list", "--input", '{"status":"SENT"}'])).toEqual({
      kind: "call", path: "invoice.list", input: { status: "SENT" }, mode: "local",
    });
    expect(parseArgs(["--remote", "invoice.list"]).kind).toBe("call");
    expect((parseArgs(["--remote", "invoice.list"]) as { mode: Mode }).mode).toBe("remote");
  });

  it("--input=json-formen stöds", () => {
    expect(parseArgs(["invoice.list", '--input={"a":1}'])).toEqual({
      kind: "call", path: "invoice.list", input: { a: 1 }, mode: "local",
    });
  });

  it("ogiltig JSON → error", () => {
    expect(parseArgs(["invoice.list", "--input", "{bad"]).kind).toBe("error");
  });
});

describe("parseArgs — ergonomi (#913)", () => {
  it("space-separerad path ≡ punktseparerad", () => {
    expect(parseArgs(["invoice", "list"])).toEqual({ kind: "call", path: "invoice.list", input: {}, mode: "local" });
    expect(parseArgs(["contacts", "getById", "--id", "c-1"])).toEqual({
      kind: "call", path: "contacts.getById", input: { id: "c-1" }, mode: "local",
    });
  });

  it("--<fält>-flaggor med JSON-koercering", () => {
    expect(parseArgs(["contacts.list", "--page", "1", "--active", "true", "--q", "Ada"])).toEqual({
      kind: "call", path: "contacts.list", input: { page: 1, active: true, q: "Ada" }, mode: "local",
    });
  });

  it("--fält=värde och bar --fält (→ true)", () => {
    expect(parseArgs(["x.y", "--id=c-1", "--dryRun"])).toEqual({
      kind: "call", path: "x.y", input: { id: "c-1", dryRun: true }, mode: "local",
    });
  });

  it("array-koercering via JSON", () => {
    expect((parseArgs(["x.y", "--ids", '["a","b"]']) as { input: unknown }).input).toEqual({ ids: ["a", "b"] });
  });

  it("--<fält> slås ihop ovanpå --input", () => {
    expect(parseArgs(["invoice.list", "--input", '{"a":1}', "--status", "SENT"])).toEqual({
      kind: "call", path: "invoice.list", input: { a: 1, status: "SENT" }, mode: "local",
    });
  });

  it("--<fält> + icke-objekt-input → error", () => {
    expect(parseArgs(["x.y", "--input", "[1,2]", "--k", "v"]).kind).toBe("error");
  });

  it("describe med space-separerat prefix", () => {
    expect(parseArgs(["describe", "invoice", "list"])).toEqual({ kind: "describe", prefix: "invoice.list" });
  });
});

describe("runParsed", () => {
  it("help skriver USAGE", async () => {
    const { deps } = fakeDeps();
    const res = await runParsed({ kind: "help" }, deps);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(USAGE);
  });

  it("error → kod 2 + usage", async () => {
    const { deps } = fakeDeps();
    const res = await runParsed({ kind: "error", message: "trasig" }, deps);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("trasig");
    expect(res.stderr).toContain("Användning");
  });

  it("describe filtrerar på prefix", async () => {
    const { deps } = fakeDeps();
    const all = await runParsed({ kind: "describe", prefix: null }, deps);
    expect(JSON.parse(all.stdout)).toHaveLength(2);
    const filtered = await runParsed({ kind: "describe", prefix: "invoice.create" }, deps);
    expect(JSON.parse(filtered.stdout)).toHaveLength(1);
  });

  it("call: okänd procedur → kod 1", async () => {
    const { deps } = fakeDeps();
    const res = await runParsed({ kind: "call", path: "nope.x", input: {}, mode: "local" }, deps);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr).error).toContain("Okänd procedur");
  });

  it("call: lyckas → JSON-resultat + rätt caller-anrop", async () => {
    const { deps, calls } = fakeDeps();
    const res = await runParsed({ kind: "call", path: "invoice.list", input: { status: "SENT" }, mode: "local" }, deps);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ echoed: { status: "SENT" } });
    expect(calls).toEqual([{ path: "invoice.list", input: { status: "SENT" }, mode: "local" }]);
  });

  it("call: caller kastar → kod 1 med fel-JSON", async () => {
    const { deps } = fakeDeps({
      openCaller: (): AvaCaller => ({
        invoke: () => Promise.reject(new Error("boom")),
        close: () => Promise.resolve(),
      }),
    });
    const res = await runParsed({ kind: "call", path: "invoice.list", input: {}, mode: "local" }, deps);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr).error).toBe("boom");
  });

  it("call: openCaller kastar (t.ex. saknad remote-env) → kod 1", async () => {
    const { deps } = fakeDeps({
      openCaller: (): AvaCaller => {
        throw new Error("AVA_SERVER_URL saknas");
      },
    });
    const res = await runParsed({ kind: "call", path: "invoice.list", input: {}, mode: "remote" }, deps);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr).error).toContain("AVA_SERVER_URL");
  });
});
