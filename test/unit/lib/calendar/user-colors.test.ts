import { describe, it, expect } from "vitest";
import { colorForUserId, hashString, paletteSize, buildUserColorMap } from "@/client/lib/calendar/user-colors";

describe("colorForUserId", () => {
  it("ger samma färg för samma id (stabil)", () => {
    expect(colorForUserId("u-anna")).toEqual(colorForUserId("u-anna"));
    expect(colorForUserId("current-user")).toEqual(colorForUserId("current-user"));
  });

  it("ger sannolikt olika färger för olika id:n (sample-test)", () => {
    // Inom ett byrå-likt antal (5 användare) ska vi få distinkta färger
    const ids = ["current-user", "u-bjorn", "u-cecilia", "u-david", "u-eva"];
    const colors = new Set(ids.map((i) => colorForUserId(i).bg));
    expect(colors.size).toBeGreaterThanOrEqual(4); // tillåt 1 kollision pga hash-modulo
  });

  it("returnerar fallback (slate) för tom sträng", () => {
    const c = colorForUserId("");
    expect(c.bg).toBeDefined();
    expect(c.text).toBe("#ffffff");
  });

  it("alla färger har vit text (kontrastsäkert mot mörka bakgrunder)", () => {
    for (let i = 0; i < paletteSize(); i++) {
      // Olika id:n täcker hela paletten via modulo
      const c = colorForUserId(`probe-${i}`);
      expect(c.text).toBe("#ffffff");
      expect(c.bg.startsWith("#")).toBe(true);
      expect(c.bgLight.startsWith("#")).toBe(true);
    }
  });
});

describe("buildUserColorMap", () => {
  it("returnerar UNIKA färger för upp till PALETTE_SIZE användare", () => {
    const ids = Array.from({ length: paletteSize() }, (_, i) => `u-${i}`);
    const map = buildUserColorMap(ids);
    const bgs = new Set(Array.from(map.values()).map((c) => c.bg));
    expect(bgs.size).toBe(ids.length);
  });

  it("5 seed-user-ids där hash kolliderar ger ändå distinkta färger", () => {
    // Verifierar buggen som rapporterades: vissa id:n hash:ar till samma
    // modulo-index. Med map-baserat tillvägagångssätt blir de unika.
    const ids = ["current-user", "u-bjorn", "u-cecilia", "u-david", "u-eva"];
    const map = buildUserColorMap(ids);
    const bgs = new Set(Array.from(map.values()).map((c) => c.bg));
    expect(bgs.size).toBe(ids.length);
  });

  it("är deterministisk: samma ids → samma färger oavsett input-ordning", () => {
    const a = buildUserColorMap(["a", "b", "c"]);
    const b = buildUserColorMap(["c", "a", "b"]);
    expect(a.get("a")).toEqual(b.get("a"));
    expect(a.get("b")).toEqual(b.get("b"));
    expect(a.get("c")).toEqual(b.get("c"));
  });

  it("hanterar >PALETTE_SIZE användare via cykel (degenerar gracefullt)", () => {
    const n = paletteSize() + 3;
    const ids = Array.from({ length: n }, (_, i) => `u-${i}`);
    const map = buildUserColorMap(ids);
    expect(map.size).toBe(n);
    // Inga kollisioner inom de första PALETTE_SIZE
    const firstBatch = Array.from(map.values()).slice(0, paletteSize()).map((c) => c.bg);
    expect(new Set(firstBatch).size).toBe(paletteSize());
  });

  it("tom input → tom map", () => {
    expect(buildUserColorMap([]).size).toBe(0);
  });
});

describe("hashString", () => {
  it("returnerar 32-bit unsigned int", () => {
    const h = hashString("abc");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it("är deterministisk", () => {
    expect(hashString("hej")).toBe(hashString("hej"));
  });

  it("skiljer även korta strängar", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});
