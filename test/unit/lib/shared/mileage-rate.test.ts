/**
 * Milersättningens omräkning (#1527): lagras i öre/km, visas och matas in i kr/mil.
 */

import { describe, it, expect } from "vitest-compat";
import {
  MILEAGE_RATE_ORE_PER_MIL_BY_VEHICLE,
  mileageRateFromFormValue,
  mileageRateFromKrPerMil,
  mileageRateKrPerMil,
  mileageRateOrePerMil,
  mileageRateToFormValue,
  standardMileageKrPerMil,
} from "@/lib/shared/mileage-rate";
import { VEHICLE_TYPE_LABELS, vehicleTypeSchema } from "@/lib/shared/schemas/enums";
import { userSchema } from "@/lib/shared/schemas/user";

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

describe("Skatteverkets schablon per biltyp (#1528)", () => {
  it("2026: egen bil 25, förmånsbil helt el 9,50, förmånsbil ej helt el 12 kr/mil", () => {
    expect(standardMileageKrPerMil("OWN_CAR")).toBe(25);
    expect(standardMileageKrPerMil("COMPANY_CAR_ELECTRIC")).toBe(9.5);
    expect(standardMileageKrPerMil("COMPANY_CAR_OTHER")).toBe(12);
  });

  it("har en nivå för varje biltyp, och varje nivå lagras exakt i öre/km", () => {
    expect(Object.keys(MILEAGE_RATE_ORE_PER_MIL_BY_VEHICLE).sort()).toEqual(Object.keys(VEHICLE_TYPE_LABELS).sort());
    for (const orePerMil of Object.values(MILEAGE_RATE_ORE_PER_MIL_BY_VEHICLE)) {
      expect(mileageRateKrPerMil(mileageRateFromKrPerMil(orePerMil / 100))).toBe(orePerMil / 100);
    }
  });
});

describe("mileageRateKrPerMil / mileageRateFromKrPerMil", () => {
  it("räknar om öre/km till kr/mil som tal; inget värde → null", () => {
    expect(mileageRateKrPerMil(250)).toBe(25);
    expect(mileageRateKrPerMil(95)).toBe(9.5);
    expect(mileageRateKrPerMil(null)).toBeNull();
    expect(mileageRateKrPerMil(undefined)).toBeNull();
  });

  it("räknar om kr/mil till närmaste hela öre/km", () => {
    expect(mileageRateFromKrPerMil(9.5)).toBe(95);
    expect(mileageRateFromKrPerMil(18.55)).toBe(186);
  });
});

describe("biltypen i schemat (#1528)", () => {
  it("vehicleTypeSchema tar de tre biltyperna och inget annat", () => {
    for (const t of ["OWN_CAR", "COMPANY_CAR_ELECTRIC", "COMPANY_CAR_OTHER"]) {
      expect(vehicleTypeSchema.parse(t)).toBe(t);
    }
    expect(vehicleTypeSchema.safeParse("BUSS").success).toBe(false);
  });

  it("userSchema tar en biltyp eller null", () => {
    const at = new Date("2026-01-01");
    const base = { id: "u1", organizationId: "o1", email: "a@x", name: "A", createdAt: at, updatedAt: at };
    expect(userSchema.parse({ ...base, vehicleType: "OWN_CAR" }).vehicleType).toBe("OWN_CAR");
    expect(userSchema.parse({ ...base, vehicleType: null }).vehicleType).toBeNull();
    expect(userSchema.safeParse({ ...base, vehicleType: "BUSS" }).success).toBe(false);
  });
});
