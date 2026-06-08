import { describe, expect, test } from "bun:test";

import { spawnDetached } from "../src/platform/spawn.ts";
import { expectRejection } from "./helpers.ts";

describe("spawnDetached", () => {
  test("resolvar när ett giltigt kommando startat", async () => {
    // process.execPath = bun-binären; `--version` startar + avslutar direkt.
    expect(await spawnDetached(process.execPath, ["--version"]).started).toBeUndefined();
  });

  test("rejectar när programmet inte finns", async () => {
    const err = await expectRejection(spawnDetached("definitely-not-a-real-binary-xyz123", []).started);
    expect(err).toBeDefined();
  });
});
