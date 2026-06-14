import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { initLog, log, resolveLogDir } from "../src/log.ts";

describe("resolveLogDir", () => {
  test("macOS → ~/Library/Logs/AVA", () => {
    expect(resolveLogDir("darwin", "/Users/u")).toBe("/Users/u/Library/Logs/AVA");
  });
  test("Windows → %LOCALAPPDATA%\\AVA\\Logs", () => {
    expect(resolveLogDir("windows", "C:\\Users\\u", "C:\\Users\\u\\AppData\\Local")).toBe(
      "C:\\Users\\u\\AppData\\Local/AVA/Logs",
    );
  });
  test("Windows utan LOCALAPPDATA faller tillbaka på home", () => {
    expect(resolveLogDir("windows", "/home/u")).toBe("/home/u/AVA/Logs");
  });
  test("Linux/övrigt → ~/.local/state/AVA", () => {
    expect(resolveLogDir("linux", "/home/u")).toBe("/home/u/.local/state/AVA");
    expect(resolveLogDir("other", "/home/u")).toBe("/home/u/.local/state/AVA");
  });
  test("tom home → null", () => {
    expect(resolveLogDir("darwin", "")).toBeNull();
  });
});

describe("initLog + log", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  test("skapar helper.log och appendar rader", async () => {
    const base = await mkdtemp(join(tmpdir(), "ava-log-"));
    dirs.push(base);
    const logDir = join(base, "logs");

    const path = initLog(logDir);
    expect(path).toBe(join(logDir, "helper.log"));

    log("rad-ett");
    log("rad-två");
    const content = await readFile(path as string, "utf8");
    expect(content).toContain("rad-ett");
    expect(content).toContain("rad-två");
    // ISO-tidsstämpel-prefix
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("null-dir → ingen fil, ingen krasch", () => {
    expect(initLog(null)).toBeNull();
  });
});
