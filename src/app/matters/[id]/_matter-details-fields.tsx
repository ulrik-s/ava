"use client";

/**
 * Ärendeuppgifternas fält i "Ändra ärende"-dialogen (#1565): titel,
 * ärendetyp ur byråns lista, målnummer, försäkringsreferens (bara med
 * försäkringsbolag) och beskrivning. Styrd komponent (`value`/`onChange`),
 * som `PaymentMethodFields`.
 */

import { useId } from "react";
import { MatterTypeSelect } from "@/components/matter/matter-type-select";
import type { MatterDetailsValues } from "./_matter-edit-input";

const INPUT_CLASS = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1";

/** Ett textfält med synlig etikett. */
function TextField({ label, value, onChange, multiline = false }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      {multiline
        ? <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={INPUT_CLASS} />
        : <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} />}
    </div>
  );
}

/** Ärendetyp ur byråns lista; utan typer en hänvisning till Inställningar. */
function MatterTypeChoice({ value, types, onChange }: { value: string; types: readonly string[]; onChange: (v: string) => void }) {
  if (types.length > 0) return <MatterTypeSelect value={value} types={types} onChange={onChange} />;
  return (
    <p className="text-sm text-gray-500">
      Byrån har inga ärendetyper. Ärendetyper läggs in under Inställningar.
    </p>
  );
}

/** Props för {@link MatterDetailsFields}. */
export interface MatterDetailsFieldsProps {
  value: MatterDetailsValues;
  onChange: (next: MatterDetailsValues) => void;
  matterTypes: readonly string[];
  showInsuranceReference: boolean;
}

export function MatterDetailsFields({ value, onChange, matterTypes, showInsuranceReference }: MatterDetailsFieldsProps) {
  const set = <K extends keyof MatterDetailsValues>(key: K) => (v: MatterDetailsValues[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-3">
      <TextField label="Titel" value={value.title} onChange={set("title")} />
      <MatterTypeChoice value={value.matterType} types={matterTypes} onChange={set("matterType")} />
      <TextField label="Målnummer" value={value.courtCaseNumber} onChange={set("courtCaseNumber")} />
      {showInsuranceReference && (
        <TextField label="Försäkringsreferens" value={value.insuranceReference} onChange={set("insuranceReference")} />
      )}
      <TextField label="Beskrivning" value={value.description} onChange={set("description")} multiline />
    </div>
  );
}
