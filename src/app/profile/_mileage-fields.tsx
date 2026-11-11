"use client";

/**
 * Biltyp + milersättning under Min profil (#1528). Valet av biltyp fyller i
 * Skatteverkets schablon i kr/mil; juristen kan sedan skriva över beloppet.
 */

import { DecimalInput } from "@/components/ui/decimal-input";
import { standardMileageKrPerMil } from "@/lib/shared/mileage-rate";
import { VEHICLE_TYPE_LABELS, vehicleTypeSchema, type VehicleType } from "@/lib/shared/schemas/enums";
import { Field } from "./_field";

/** Formulärets milersättningsdel: biltyp + belopp i kr/mil (null = tomt). */
export interface MileageFormValue {
  vehicleType: VehicleType | null;
  mileageKrPerMil: number | null;
}

const INPUT_CLASS = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm";

/** Ny biltyp → nya formulärvärden; inget val behåller beloppet. */
export function pickVehicleType(raw: string, current: MileageFormValue): MileageFormValue {
  const parsed = vehicleTypeSchema.safeParse(raw);
  if (!parsed.success) return { ...current, vehicleType: null };
  return { vehicleType: parsed.data, mileageKrPerMil: standardMileageKrPerMil(parsed.data) };
}

export function MileageFields({ value, onChange }: {
  value: MileageFormValue;
  onChange: (next: MileageFormValue) => void;
}) {
  return (
    <>
      <Field label="Biltyp">
        <select
          value={value.vehicleType ?? ""}
          onChange={(e) => onChange(pickVehicleType(e.target.value, value))}
          className={INPUT_CLASS}
        >
          <option value="">Ingen vald</option>
          {Object.entries(VEHICLE_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </Field>
      <Field label="Milersättning (kr/mil)">
        <DecimalInput
          value={value.mileageKrPerMil}
          onChange={(mileageKrPerMil) => onChange({ ...value, mileageKrPerMil })}
          className={INPUT_CLASS}
        />
      </Field>
    </>
  );
}
