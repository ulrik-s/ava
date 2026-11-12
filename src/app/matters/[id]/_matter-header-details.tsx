/**
 * Ärendets uppgifter i ärendehuvudet som läsvy (#1566): de ändras bara via
 * "Ändra"-dialogen (#1565). Saknade uppgifter visas med etikett och streck.
 * Rena visningskomponenter, utbrutna ur MatterHeader som `MatterPaymentLine`
 * (#199).
 */

import { hasInsuranceCompany, type MatterContactWithRole } from "@/lib/shared/matter-insurance";

/** Strecket som står för en saknad uppgift. */
export const MISSING_VALUE = "–";

/** "Etikett: värde", eller "Etikett: –" när värdet saknas. */
function LabeledValue({ label, value, mono = false, testId }: {
  label: string; value: string | null | undefined; mono?: boolean; testId: string;
}) {
  return (
    <span className="text-sm text-gray-500" data-testid={testId}>
      {label}: <span className={mono ? "font-mono text-gray-700" : "text-gray-700"}>{value || MISSING_VALUE}</span>
    </span>
  );
}

/** Ärendetypen på klientraden: fetstil när den finns (även en äldre fritext-typ
 *  som inte finns i byråns lista visas som den är), annars "Ärendetyp: –". */
export function MatterTypeText({ matterType }: { matterType?: string | null | undefined }) {
  if (!matterType) return <LabeledValue label="Ärendetyp" value="" testId="matter-type" />;
  return <span className="text-sm font-bold text-gray-900" data-testid="matter-type">{matterType}</span>;
}

/** Props för {@link MatterHeaderDetails}. */
export interface MatterHeaderDetailsProps {
  courtCaseNumber: string;
  previousCourtCaseNumber: string;
  insuranceReference: string;
  description?: string | null | undefined;
  /** Ärendets kontakter — försäkringsreferensen visas bara med ett
   *  försäkringsbolag som inte står på motsidan (#1511/#1532). */
  contacts: readonly MatterContactWithRole[];
}

/** Målnummer (med tidigare målnr), försäkringsreferens och beskrivning. */
export function MatterHeaderDetails({
  courtCaseNumber, previousCourtCaseNumber, insuranceReference, description, contacts,
}: MatterHeaderDetailsProps) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      <LabeledValue label="Målnummer" value={courtCaseNumber} mono testId="matter-court-case-number" />
      {previousCourtCaseNumber && (
        <span className="text-xs text-gray-500">
          Tidigare målnr <span className="font-mono text-gray-700">{previousCourtCaseNumber}</span>
        </span>
      )}
      {hasInsuranceCompany(contacts) && (
        <LabeledValue label="Försäkringsreferens" value={insuranceReference} mono testId="matter-insurance-reference" />
      )}
      <span className="min-w-0 flex-1 truncate" title={description ?? undefined}>
        <LabeledValue label="Beskrivning" value={description} testId="matter-description" />
      </span>
    </div>
  );
}
