import { describe, expect, test } from "bun:test";

import { currentPlatform, platformFrom } from "../src/engine/platform/runtime.ts";

describe("platformFrom", () => {
  test("normaliserar Node:s plattforms-strängar", () => {
    expect(platformFrom("darwin")).toBe("darwin");
    expect(platformFrom("linux")).toBe("linux");
    expect(platformFrom("win32")).toBe("windows");
  });
  test("okänt OS → 'other'", () => {
    expect(platformFrom("freebsd")).toBe("other");
    expect(platformFrom("")).toBe("other");
  });
});

describe("currentPlatform", () => {
  test("returnerar en av union-värdena", () => {
    expect(["darwin", "linux", "windows", "other"]).toContain(currentPlatform());
  });
});
