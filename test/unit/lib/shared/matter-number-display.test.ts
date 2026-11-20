/**
 * Visningsregeln för ärendenummer (#1727): initialer framför numret när
 * numret inte redan bär den ansvariga juristens prefix.
 */
import { describe, expect, it } from "vitest-compat";
import { MATTER_NUMBER_RE, matterNumberInitials } from "@/lib/shared/matter-number-display";

describe("matterNumberInitials", () => {
  it("ingen ansvarig → bara numret", () => {
    expect(matterNumberInitials("2026-0001", undefined)).toBeNull();
  });

  it("ansvarig utan prefix → bara numret", () => {
    expect(matterNumberInitials("2026-0001", null)).toBeNull();
    expect(matterNumberInitials("2026-0001", "")).toBeNull();
  });

  it("samma prefix som numret → bara numret", () => {
    expect(matterNumberInitials("AB2026-0001", "AB")).toBeNull();
  });

  it("annat prefix än numrets → juristens initialer", () => {
    expect(matterNumberInitials("AB2026-0001", "CD")).toBe("CD");
  });

  it("nummer utan prefix → juristens initialer", () => {
    expect(matterNumberInitials("2026-0001", "AB")).toBe("AB");
  });

  it("nummer som inte följer formatet → juristens initialer", () => {
    expect(matterNumberInitials("Gammalt-17", "AB")).toBe("AB");
  });

  it("byte av ansvarig: samma nummer ger den nya juristens initialer", () => {
    expect(matterNumberInitials("AB2026-0001", "AB")).toBeNull();
    expect(matterNumberInitials("AB2026-0001", "EF")).toBe("EF");
  });
});

describe("MATTER_NUMBER_RE", () => {
  it("fångar prefix, år och löpnummer", () => {
    expect(MATTER_NUMBER_RE.exec("AB2026-0042")?.slice(1)).toEqual(["AB", "2026", "0042"]);
    expect(MATTER_NUMBER_RE.exec("2026-10000")?.[3]).toBe("10000");
  });
});
