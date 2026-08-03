"use client";

/**
 * `StandardAtgardSuggestions` (#958) — påminner om byråns standardåtgärder vid
 * rätt tidpunkt i ärendet. Just de här åtgärderna glöms i praktiken: "Avslutande
 * åtgärder inklusive mottagande av dom och kontakt med huvudman" registreras när
 * ärendet redan känns färdigt.
 *
 * Ett klick FÖRIFYLLER tidsformuläret — den sparar inget. Datumet måste vara
 * handläggarens val: det styr vilken årsnorm posten värderas på (#951/#954), och
 * en autoinlagd post med fel datum ger fel belopp i acontot.
 */

import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import type { MatterStatus, PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { suggestedStandardAtgarder, type StandardAtgard } from "@/lib/shared/standard-atgard";

interface Props {
  matterId: MatterId;
  paymentMethod?: PaymentMethod | undefined;
  matterStatus?: MatterStatus | undefined;
  /** Ärendets tidsposter (redan hämtade av TimeSection) — driver både
   *  "uppdraget är nytt" och vilka standardåtgärder som redan är registrerade. */
  entries: ReadonlyArray<{ standardAtgardId?: string | null }>;
  /** Öppnar tidsformuläret förifyllt med åtgärden. */
  onPick: (atgard: StandardAtgard) => void;
}

/** Billing-run-rader vi behöver för att veta var i uppdraget ärendet befinner sig. */
interface RunRow {
  type: string;
  awardedOre?: number | null;
}

/** Domen/beslutet är registrerat när en kostnadsräkning fått sitt beslut (#828). */
function verdictRegistered(runs: readonly RunRow[]): boolean {
  return runs.some((r) => r.type === "KOSTNADSRAKNING" && r.awardedOre != null);
}

/** Slutreglerat = en FINAL finns. Då är arbetet fryst (`settleCoverage`/`createFinal`)
 *  och en ny tidspost kan inte längre nå fakturan. */
function isSettled(runs: readonly RunRow[]): boolean {
  return runs.some((r) => r.type === "FINAL");
}

export function StandardAtgardSuggestions({ matterId, paymentMethod, matterStatus, entries, onPick }: Props) {
  const settings = trpc.organization.getSettings.useQuery();
  const runs = (trpc.billingRun.list.useQuery({ matterId }).data?.runs ?? []) as RunRow[];

  const suggestions = suggestedStandardAtgarder(settings.data?.standardAtgarder, paymentMethod, {
    hasTimeEntries: entries.length > 0,
    verdictRegistered: verdictRegistered(runs),
    matterClosed: matterStatus !== undefined && matterStatus !== "ACTIVE",
    settled: isSettled(runs),
    registeredIds: new Set(entries.map((e) => e.standardAtgardId).filter((id): id is string => !!id)),
  });
  if (suggestions.length === 0) return null;

  return (
    <div className="mx-4 mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <div className="mb-1.5">
        Byråns <strong>standardåtgärder</strong> som inte är registrerade i ärendet:
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((a) => (
          <button key={a.id} type="button" onClick={() => onPick(a)}
            className="rounded border border-blue-300 bg-white px-2 py-1 text-left hover:bg-blue-100">
            {a.description} <span className="font-mono text-blue-700">({formatMinutes(a.minutes)})</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-blue-700">
        Klicket fyller formuläret — inget sparas förrän du valt datum och godkänt tiden.
      </p>
    </div>
  );
}
