import { describe, expect, test } from "bun:test";

import { resolveDataDir } from "../src/engine/paths.ts";

describe("resolveDataDir", () => {
  test("macOS → ~/Library/Application Support/AVA", () => {
    expect(resolveDataDir("darwin", "/Users/u")).toBe("/Users/u/Library/Application Support/AVA");
  });
  test("Windows → %LOCALAPPDATA%\\AVA", () => {
    expect(resolveDataDir("windows", "C:\\Users\\u", { localAppData: "C:\\Users\\u\\AppData\\Local" })).toBe(
      "C:\\Users\\u\\AppData\\Local/AVA",
    );
  });
  test("Linux → $XDG_DATA_HOME/AVA om satt", () => {
    expect(resolveDataDir("linux", "/home/u", { xdgDataHome: "/home/u/.xdgdata" })).toBe("/home/u/.xdgdata/AVA");
  });
  test("Linux utan XDG → ~/.local/share/AVA", () => {
    expect(resolveDataDir("linux", "/home/u")).toBe("/home/u/.local/share/AVA");
  });
  test("tom home → null", () => {
    expect(resolveDataDir("darwin", "")).toBeNull();
  });
});
