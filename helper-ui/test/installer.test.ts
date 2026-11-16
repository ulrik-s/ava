/** "Uppdatera nu" (installer.ts): skriptet körs frikopplat via bash med loggfil. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { INSTALL_SCRIPT, runInstaller, type SpawnFn } from "../src/installer.ts";

describe("runInstaller", () => {
  test("bash -s, frikopplad, skriptet på stdin, unref", () => {
    const calls: Array<{ cmd: string; args: readonly string[]; detached: unknown; stdin?: string; unref: boolean }> = [];
    const spawnFn: SpawnFn = (cmd, args, opts) => {
      const call: (typeof calls)[number] = { cmd, args, detached: opts.detached, unref: false };
      calls.push(call);
      return { stdin: { end: (data) => { call.stdin = data; } }, unref: () => { call.unref = true; } };
    };
    const log = join(mkdtempSync(join(tmpdir(), "inst-")), "logs", "install.log");
    runInstaller("echo hej", log, spawnFn);
    expect(calls).toEqual([{ cmd: "/bin/bash", args: ["-s"], detached: true, stdin: "echo hej", unref: true }]);
  });

  test("i dev (inget inbakat skript) → null", () => {
    expect(INSTALL_SCRIPT).toBeNull();
  });
});
