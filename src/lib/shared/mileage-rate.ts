/**
 * Milersättning (#1527): lagras som heltal öre per **km** (`users.mileage_rate`),
 * men visas och matas in i kr per **mil** som Skatteverket anger den (1 mil = 10 km).
 * Lagringen ändras inte; omräkningen finns bara här.
 */

/** Kilometer per mil. */
const KM_PER_MIL = 10;

/** Lagrat värde (öre/km) → öre/mil, för beloppsvisning med `formatCurrency`. */
export function mileageRateOrePerMil(orePerKm: number): number {
  return orePerKm * KM_PER_MIL;
}

/** Lagrat värde (öre/km) → formulärets text i kr/mil; inget värde → tomt fält. */
export function mileageRateToFormValue(orePerKm: number | null | undefined): string {
  return orePerKm != null ? String(mileageRateOrePerMil(orePerKm) / 100) : "";
}

/** Formulärets text i kr/mil → lagrat värde (närmaste hela öre/km); tomt fält → inget värde. */
export function mileageRateFromFormValue(krPerMil: string): number | undefined {
  return krPerMil ? Math.round((Number(krPerMil) * 100) / KM_PER_MIL) : undefined;
}
