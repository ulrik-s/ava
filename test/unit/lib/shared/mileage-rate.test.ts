/**
 * Milersättningens omräkning (#1527): lagras i öre/km, visas och matas in i kr/mil.
 */

import { describe, it, expect } from "vitest-compat";
import {
  mileageRateFromFormValue,
  mileageRateOrePerMil,
  mileageRateToFormValue,
} from "@/lib/shared/mileage-rate";

describe("mileageRateOrePerMil", () => {
  it("räknar om öre/km till öre/mil", () => {
    expect(mileageRateOrePerMil(250)).toBe(2500);
    expect(mileageRateOrePerMil(95)).toBe(950);
  });
});

describe("mileageRateToFormValue", () => {
  it("visar lagrat öre/km som kr/mil", () => {
    expect(mileageRateToFormValue(250)).toBe("25");
    expect(mileageRateToFormValue(95)).toBe("9.5");
    expect(mileageRateToFormValue(120)).toBe("12");
  });

  it("tomt fält utan värde", () => {
    expect(mileageRateToFormValue(null)).toBe("");
    expect(mileageRateToFormValue(undefined)).toBe("");
  });
});

describe("mileageRateFromFormValue", () => {
  it("sparar kr/mil som öre/km", () => {
    expect(mileageRateFromFormValue("25")).toBe(250);
    expect(mileageRateFromFormValue("9.50")).toBe(95);
    expect(mileageRateFromFormValue("12")).toBe(120);
  });

  it("avrundar till närmaste hela öre/km", () => {
    expect(mileageRateFromFormValue("25.04")).toBe(250);
    expect(mileageRateFromFormValue("25.06")).toBe(251);
  });

  it("tomt fält sparar inget värde", () => {
    expect(mileageRateFromFormValue("")).toBeUndefined();
  });

  it("tål en tur och retur utan avvikelse", () => {
    for (const orePerKm of [95, 120, 250]) {
      expect(mileageRateFromFormValue(mileageRateToFormValue(orePerKm))).toBe(orePerKm);
    }
  });
});
