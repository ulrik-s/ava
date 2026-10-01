/**
 * Ramarna ur en stack trace (#1343): kod ut, innehåll aldrig.
 */

import { describe, it, expect } from "vitest-compat";
import { MAX_FRAMES, relativeFilename, stackFrames } from "@/lib/server/observability/stack-frames";

/** Ett fel med en given stack — exakt det runtime:n skulle ha skrivit. */
function withStack(message: string, stack: string): Error {
  const e = new Error(message);
  e.stack = stack;
  return e;
}

describe("relativeFilename", () => {
  it.each([
    ["/home/ava/app/src/lib/x.ts", "src/lib/x.ts"],
    ["file:///opt/ava/node_modules/pg/index.js", "node_modules/pg/index.js"],
    ["/Users/ulrik/repo/tooling/scripts/a.ts", "tooling/scripts/a.ts"],
    ["/$bunfs/root/ava-server-first-linux-x64", "ava-server-first-linux-x64"],
    ["native", "native"],
  ])("%s → %s", (input, expected) => {
    expect(relativeFilename(input)).toBe(expected);
  });
});

describe("stackFrames", () => {
  it("tolkar V8/JSC-ramar, äldst först, med och utan kolumn och funktion", () => {
    const e = withStack("boom", [
      "Error: boom",
      "    at inner (/app/src/lib/server/a.ts:10:5)",
      "    at async Object.handler (/app/node_modules/trpc/x.js:20:7)",
      "    at /app/src/bin/server.ts:3",
      "    at processTicksAndRejections (native:7:39)",
    ].join("\n"));
    expect(stackFrames(e)).toEqual([
      { filename: "native", function: "processTicksAndRejections", lineno: 7, colno: 39, in_app: false },
      { filename: "src/bin/server.ts", lineno: 3, in_app: true },
      { filename: "node_modules/trpc/x.js", function: "async Object.handler", lineno: 20, colno: 7, in_app: false },
      { filename: "src/lib/server/a.ts", function: "inner", lineno: 10, colno: 5, in_app: true },
    ]);
  });

  // Meddelandet kan själv se ut som en ram — det får inte smyga in.
  it("ett meddelande som liknar en ram blir ingen ram", () => {
    const message = "Klienten saknas\n    at Anna_Andersson (19670312-4521.ts:1:1)";
    const e = withStack(message, `Error: ${message}\n    at f (/app/src/a.ts:1:2)`);
    const frames = stackFrames(e);
    expect(frames).toEqual([{ filename: "src/a.ts", function: "f", lineno: 1, colno: 2, in_app: true }]);
    expect(JSON.stringify(frames)).not.toContain("Anna");
  });

  it("rader som inte är ramar kastas — även med mellanslag i funktionsnamnet", () => {
    const e = withStack("x", "Error: x\n    at Anna Andersson (a.ts:1:1)\n    at async Promise.all (index 0)\n    nonsens");
    expect(stackFrames(e)).toEqual([]);
  });

  it("behåller högst MAX_FRAMES, de nyaste", () => {
    const lines = Array.from({ length: MAX_FRAMES + 10 }, (_, i) => `    at f${i} (/app/src/a.ts:${i + 1}:1)`);
    const frames = stackFrames(withStack("", ["Error", ...lines].join("\n")));
    expect(frames).toHaveLength(MAX_FRAMES);
    expect(frames.at(-1)?.function).toBe("f0");
  });

  it("ett riktigt fel ger ramar som pekar på den här filen", () => {
    const frames = stackFrames(new Error("riktigt"));
    expect(frames.some((f) => f.filename.endsWith("stack-frames.test.ts"))).toBe(true);
  });

  it.each([
    ["en sträng", "boom"],
    ["null", null],
    ["ett fel utan stack", Object.assign(new Error("x"), { stack: undefined })],
  ])("%s ger inga ramar", (_label, value) => {
    expect(stackFrames(value)).toEqual([]);
  });
});
