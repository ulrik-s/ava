/**
 * Demo-e2e:ts port per worktree (#1261): parallella worktrees ska inte dela
 * server, och samma worktree ska alltid hamna på samma port.
 */
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  DEMO_PORT_MIN,
  DEMO_PORT_SPAN,
  PROJECT_ROOT,
  demoPort,
  worktreePort,
} from "../../../tooling/config/demo-e2e-port";

describe("worktreePort", () => {
  it("är stabil för samma sökväg", () => {
    expect(worktreePort("/src/ava")).toBe(worktreePort("/src/ava"));
  });

  it("ligger i intervallet 8800–8999", () => {
    for (const root of ["/src/ava", "/src/ava/.claude/worktrees/a", "/x", ""]) {
      const port = worktreePort(root);
      expect(port).toBeGreaterThanOrEqual(DEMO_PORT_MIN);
      expect(port).toBeLessThan(DEMO_PORT_MIN + DEMO_PORT_SPAN);
    }
  });

  it("sprider olika worktrees på olika portar", () => {
    const roots = Array.from({ length: 10 }, (_, i) => `/Users/dev/src/ava/.claude/worktrees/agent-${i}`);
    expect(new Set(roots.map(worktreePort)).size).toBeGreaterThan(5);
  });
});

describe("demoPort", () => {
  it("härleder porten ur worktreen utan DEMO_PORT", () => {
    expect(demoPort({}, "/src/ava")).toBe(worktreePort("/src/ava"));
  });

  it("DEMO_PORT vinner", () => {
    expect(demoPort({ DEMO_PORT: "8123" }, "/src/ava")).toBe(8123);
  });

  it.each(["abc", "0", "70000", "80.5"])("avvisar ogiltig DEMO_PORT %s", (value) => {
    expect(() => demoPort({ DEMO_PORT: value })).toThrow(/DEMO_PORT måste vara en port/);
  });

  it("defaultar till repo-roten för den här worktreen", () => {
    expect(PROJECT_ROOT).toBe(path.resolve(import.meta.dir, "..", "..", ".."));
    expect(demoPort({})).toBe(worktreePort(PROJECT_ROOT));
  });
});
