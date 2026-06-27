"use client";

/**
 * `RattsskyddNekadBanner` (#811) — när försäkringen NEKAT rättsskydd är nästa
 * steg att ansöka om rättshjälp, förutsatt att klientens ekonomiska underlag
 * inte överstiger gränsen i 6 § rättshjälpslagen. Banner + snabbåtgärd som byter
 * ärendets betalningssätt till rättshjälp. §6-prövningen är manuell (vi har ingen
 * inkomstdata, och gränsbeloppet ändras) — texten påminner om kontrollen.
 */

import { trpc } from "@/lib/client/trpc";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

function formatDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function RattsskyddNekadBanner({ matterId, paymentMethod, rattsskyddNekadAt }: {
  matterId: MatterId;
  paymentMethod: PaymentMethod;
  rattsskyddNekadAt: Date | string | null | undefined;
}) {
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => { void utils.matter.getById.invalidate({ id: matterId }); },
  });
  if (paymentMethod !== "RATTSSKYDD" || !rattsskyddNekadAt) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">Rättsskydd nekades {formatDate(rattsskyddNekadAt)}</p>
      <p className="mt-1 text-amber-800">
        Nästa steg: ansök om rättshjälp om klientens ekonomiska underlag inte överstiger
        gränsen i 6 § rättshjälpslagen (kontrollera aktuellt gränsbelopp).
      </p>
      <button type="button" disabled={update.isPending}
        onClick={() => update.mutate({ id: matterId, paymentMethod: "RATTSHJALP" })}
        className="mt-2 px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
        {update.isPending ? "Byter…" : "Byt till rättshjälp"}
      </button>
    </div>
  );
}
