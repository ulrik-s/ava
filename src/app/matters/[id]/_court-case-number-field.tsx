"use client";

/**
 * Inline-redigering av ärendets målnummer (domstolens referens). Visas i
 * ärendehuvudet för ALLA ärenden (#1134) — även vanliga tvister har målnummer.
 * Används också som matchningsnyckel för domstolsbetalningar (#175) och är
 * sökbart i ärendelistan.
 */

import { useId, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";

export function CourtCaseNumberField({ matterId, value }: { matterId: MatterId; value: string }) {
  const id = useId();
  const [text, setText] = useState(value);
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => void utils.matter.getById.invalidate({ id: matterId }),
  });
  return (
    <div className="flex items-end gap-2 mt-4">
      <div className="flex-1 max-w-xs">
        <label htmlFor={id} className="block text-xs font-medium text-gray-500 mb-1">Målnummer</label>
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="t.ex. T 1234-26"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono" />
      </div>
      <button onClick={() => update.mutate({ id: matterId, courtCaseNumber: text || null })}
        disabled={update.isPending || text === value}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
        Spara målnummer
      </button>
    </div>
  );
}
