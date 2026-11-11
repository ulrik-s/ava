"use client";

/**
 * Inline-redigering av ärendets målnummer (domstolens referens). Visas i
 * ärendehuvudet för ALLA ärenden (#1134) — även vanliga tvister har målnummer.
 * Används också som matchningsnyckel för domstolsbetalningar (#175) och är
 * sökbart i ärendelistan. Ett tidigare målnummer (#1510) visas bredvid,
 * endast läsning, när målnumret har bytts.
 */

import type { MatterId } from "@/lib/shared/schemas/ids";
import { MatterReferenceField } from "./_matter-reference-field";

export function CourtCaseNumberField({ matterId, value, previous = "" }: { matterId: MatterId; value: string; previous?: string }) {
  return (
    <MatterReferenceField matterId={matterId} field="courtCaseNumber" value={value}
      label="Målnummer" placeholder="t.ex. T 1234-26" saveLabel="Spara målnummer">
      {previous && (
        <span className="text-xs text-gray-500">
          Tidigare målnr <span className="font-mono text-gray-700">{previous}</span>
        </span>
      )}
    </MatterReferenceField>
  );
}
