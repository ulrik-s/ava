/**
 * Milersättning (#1527): lagras som heltal öre per **km** (`users.mileage_rate`),
 * men visas och matas in i kr per **mil** som Skatteverket anger den (1 mil = 10 km).
 * Lagringen ändras inte; omräkningen finns bara här.
 */

import type { VehicleType } from "./schemas/enums";

/** Kilometer per mil. */
const KM_PER_MIL = 10;

/**
 * Skatteverkets skattefria schablon för milersättning per biltyp (#1528),
 * i öre per mil. Inkomstår 2026 (oförändrat sedan 2025).
 *
 * Källa: skatteverket.se, "Belopp och procent – inkomstår 2026"
 *   (https://www.skatteverket.se/privat/skatter/beloppochprocent/2026):
 *   egen bil 25 kr/mil, förmånsbil som drivs helt med el 9,50 kr/mil,
 *   förmånsbil som inte drivs helt med el 12 kr/mil.
 */
export const MILEAGE_RATE_ORE_PER_MIL_BY_VEHICLE = {
  OWN_CAR: 2500,
  COMPANY_CAR_ELECTRIC: 950,
  COMPANY_CAR_OTHER: 1200,
} as const satisfies Record<VehicleType, number>;

/** Lagrat värde (öre/km) → öre/mil, för beloppsvisning med `formatCurrency`. */
export function mileageRateOrePerMil(orePerKm: number): number {
  return orePerKm * KM_PER_MIL;
}

/** Lagrat värde (öre/km) → kr/mil som tal; inget värde → null (tomt fält). */
export function mileageRateKrPerMil(orePerKm: number | null | undefined): number | null {
  return orePerKm != null ? mileageRateOrePerMil(orePerKm) / 100 : null;
}

/** Kr/mil → lagrat värde (närmaste hela öre/km). */
export function mileageRateFromKrPerMil(krPerMil: number): number {
  return Math.round((krPerMil * 100) / KM_PER_MIL);
}

/** Skatteverkets schablon för biltypen, i kr/mil (#1528). */
export function standardMileageKrPerMil(vehicleType: VehicleType): number {
  return MILEAGE_RATE_ORE_PER_MIL_BY_VEHICLE[vehicleType] / 100;
}

/** Lagrat värde (öre/km) → formulärets text i kr/mil; inget värde → tomt fält. */
export function mileageRateToFormValue(orePerKm: number | null | undefined): string {
  const krPerMil = mileageRateKrPerMil(orePerKm);
  return krPerMil != null ? String(krPerMil) : "";
}

/** Formulärets text i kr/mil → lagrat värde (närmaste hela öre/km); tomt fält → inget värde. */
export function mileageRateFromFormValue(krPerMil: string): number | undefined {
  return krPerMil ? mileageRateFromKrPerMil(Number(krPerMil)) : undefined;
}
