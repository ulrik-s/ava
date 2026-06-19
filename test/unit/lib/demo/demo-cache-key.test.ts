/**
 * Tester för `demoCacheKey` — OPFS-cache-nyckeln för demo-slaben.
 *
 * Två grenar: versionerad nyckel (NEXT_PUBLIC_DEMO_VERSION satt, deploy) vs
 * stabil nyckel (osatt, lokalt). Version-prefixet trunkeras till 12 tecken.
 */

import { afterEach, describe, it, expect } from "vitest-compat";
import { demoCacheKey } from "@/lib/client/demo/demo-cache-key";

const ORIGINAL = process.env.NEXT_PUBLIC_DEMO_VERSION;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_DEMO_VERSION;
  else process.env.NEXT_PUBLIC_DEMO_VERSION = ORIGINAL;
});

describe("demoCacheKey", () => {
  it("utan version → stabil nyckel 'ava-demo' (lokalt, överlever reloads)", () => {
    delete process.env.NEXT_PUBLIC_DEMO_VERSION;
    expect(demoCacheKey()).toBe("ava-demo");
  });

  it("med version → versionerad nyckel (version-busting per deploy)", () => {
    process.env.NEXT_PUBLIC_DEMO_VERSION = "abcdef1234567890";
    expect(demoCacheKey()).toBe("ava-demo-abcdef123456");
  });

  it("trunkerar versionen till 12 tecken (lång commit-sha)", () => {
    process.env.NEXT_PUBLIC_DEMO_VERSION = "0123456789abcdef0123456789";
    expect(demoCacheKey()).toBe("ava-demo-0123456789ab");
  });

  it("kort version padd:as inte (kortare än 12 tecken används rakt av)", () => {
    process.env.NEXT_PUBLIC_DEMO_VERSION = "v1";
    expect(demoCacheKey()).toBe("ava-demo-v1");
  });

  it("tom version → faller tillbaka på stabila nyckeln (falsy)", () => {
    process.env.NEXT_PUBLIC_DEMO_VERSION = "";
    expect(demoCacheKey()).toBe("ava-demo");
  });
});
