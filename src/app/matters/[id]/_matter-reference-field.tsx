"use client";

/**
 * Inline-redigerbart referensfält i ärendehuvudet (målnummer #1134,
 * försäkringsreferens #1511). "Spara" visas först när texten ändrats; ett
 * tömt fält sparas som null.
 */

import { useId, useState, type ReactNode } from "react";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Ärendefälten som redigeras med referensfältet. */
export type MatterReferenceKey = "courtCaseNumber" | "insuranceReference";

/** Props för {@link MatterReferenceField}. */
export interface MatterReferenceFieldProps {
  matterId: MatterId;
  field: MatterReferenceKey;
  value: string;
  label: string;
  placeholder: string;
  saveLabel: string;
  /** Extra innehåll efter fältet (t.ex. tidigare målnummer). */
  children?: ReactNode;
}

export function MatterReferenceField({ matterId, field, value, label, placeholder, saveLabel, children }: MatterReferenceFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => void utils.matter.getById.invalidate({ id: matterId }),
  });
  const save = () => update.mutate({ id: matterId, [field]: text || null });
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-medium text-gray-500">{label}</label>
      <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        className="w-36 rounded border border-gray-300 px-2 py-0.5 text-sm font-mono" />
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
