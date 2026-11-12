"use client";

/**
 * Inline-redigerbart referensfält i ärendehuvudet (målnummer #1134,
 * försäkringsreferens #1511, ärendetyp #1521). "Spara" visas först när texten
 * ändrats; ett tömt fält sparas som null (ärendetypen, som servern inte tar
 * null för, som tom sträng). Valfria förslag visas som native `<datalist>`
 * (som `MatterCombobox`) men fritext tillåts.
 */

import { useId, useState, type ReactNode } from "react";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Ärendefälten som redigeras med referensfältet. */
export type MatterReferenceKey = "courtCaseNumber" | "insuranceReference" | "matterType";

/** Utseende: `reference` = synlig etikett + mono (målnummer m.fl.);
 *  `emphasis` = dold etikett + fetstil (ärendetypen på klientraden). */
export type MatterReferenceVariant = "reference" | "emphasis";

const VARIANT_CLASSES: Record<MatterReferenceVariant, { label: string; input: string }> = {
  reference: { label: "text-xs font-medium text-gray-500", input: "font-mono" },
  emphasis: { label: "sr-only", input: "font-bold text-gray-900" },
};

/** Värdet som skickas till `matter.update`: tomt = null, utom för ärendetypen
 *  (servern tar bara sträng där). */
function toSaveValue(field: MatterReferenceKey, text: string): string | null {
  return field === "matterType" ? text : text || null;
}

/** Props för {@link MatterReferenceField}. */
export interface MatterReferenceFieldProps {
  matterId: MatterId;
  field: MatterReferenceKey;
  value: string;
  label: string;
  placeholder: string;
  saveLabel: string;
  /** Förslag i en `<datalist>` (fritext tillåts ändå). */
  suggestions?: readonly string[];
  variant?: MatterReferenceVariant;
  /** Extra innehåll efter fältet (t.ex. tidigare målnummer). */
  children?: ReactNode;
}

export function MatterReferenceField({
  matterId, field, value, label, placeholder, saveLabel, suggestions = [], variant = "reference", children,
}: MatterReferenceFieldProps) {
  const id = useId();
  const listId = useId();
  const cls = VARIANT_CLASSES[variant];
  const [text, setText] = useState(value);
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => void utils.matter.getById.invalidate({ id: matterId }),
  });
  const save = () => update.mutate({ id: matterId, [field]: toSaveValue(field, text) });
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className={cls.label}>{label}</label>
      <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        list={suggestions.length > 0 ? listId : undefined} autoComplete="off"
        className={`w-36 rounded border border-gray-300 px-2 py-0.5 text-sm ${cls.input}`} />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
      {text !== value && (
        <button onClick={save} disabled={update.isPending}
          className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          {saveLabel}
        </button>
      )}
      {children}
    </div>
  );
}
