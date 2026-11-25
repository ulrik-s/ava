/**
 * Ärendets uppgifter i ärendehuvudet som läsvy (#1566): de ändras bara via
 * "Ändra"-dialogen (#1565). Saknade uppgifter visas med etikett och streck.
 * Rena visningskomponenter, utbrutna ur MatterHeader som `MatterPaymentLine`
 * (#199).
 */

import type { ReactNode } from "react";
import { hasInsuranceCompany, type MatterContactWithRole } from "@/lib/shared/matter-insurance";
import { SUMMARY_SEPARATOR } from "@/lib/shared/payment-method-summary";

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

/** En uppgift på klientraden, med avgränsaren före (som `MatterPaymentLine`).
 *  Avgränsaren står utanför uppgiftens test-id, så texten där är oförändrad. */
function Separated({ children, className = "", title }: {
  children: ReactNode; className?: string; title?: string | undefined;
}) {
  return (
    <span className={`text-sm text-gray-500 ${className}`} title={title}>
      <span className="whitespace-pre">{SUMMARY_SEPARATOR}</span>{children}
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
  /** Ärendets kontakter — försäkringsreferensen visas bara med en part i
   *  rollen Försäkringsbolag (#1511, #1961). */
  contacts: readonly MatterContactWithRole[];
}

/**
 * Målnummer (med tidigare målnr), försäkringsreferens och beskrivning som syskon
 * på klientraden, var och en med avgränsaren före (#1848). Beskrivning tar resten
 * av raden och kortas med "…"; får inte ens en kort bit plats bryts den till nästa rad.
 */
export function MatterHeaderDetails({
  courtCaseNumber, previousCourtCaseNumber, insuranceReference, description, contacts,
}: MatterHeaderDetailsProps) {
  return (
    <>
      <Separated>
        <LabeledValue label="Målnummer" value={courtCaseNumber} mono testId="matter-court-case-number" />
      </Separated>
      {previousCourtCaseNumber && (
        <Separated>
          <span className="text-xs">
            Tidigare målnr <span className="font-mono text-gray-700">{previousCourtCaseNumber}</span>
          </span>
        </Separated>
      )}
      {hasInsuranceCompany(contacts) && (
        <Separated>
          <LabeledValue label="Försäkringsreferens" value={insuranceReference} mono testId="matter-insurance-reference" />
        </Separated>
      )}
      <Separated className="min-w-16 flex-1 truncate" title={description ?? undefined}>
        <LabeledValue label="Beskrivning" value={description} testId="matter-description" />
      </Separated>
    </>
  );
}
