"use client";

/**
 * "Ändra" bredvid betalningssättet i ärendehuvudet (#1499). Fliken
 * Betalningssätt är borta; dess innehåll (takvarning, nekat-banner och
 * betalningskortet) öppnas i en dialog i stället. Spara stänger den.
 */

import { useState } from "react";
import { CoverageCapWarning } from "@/components/matter/coverage-cap-warning";
import { PaymentMethodCard } from "@/components/matter/payment-method-card";
import { RattsskyddNekadBanner } from "@/components/matter/rattsskydd-nekad-banner";
import { Modal } from "@/components/ui/modal";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Ärendets betalningsfält, som de kommer från `matter.getById`. */
export interface PaymentEditMatter {
  paymentMethod: PaymentMethod;
  paymentMethodNote?: string | null | undefined;
  paymentMethodDecidedAt?: Date | string | null | undefined;
  clientShareBips?: number | null | undefined;
  rattsskyddMaxOre?: number | null | undefined;
  rattshjalpMaxTimmar?: number | null | undefined;
  tvistUppkomDatum?: Date | string | null | undefined;
  rattsskyddBeslutDatum?: Date | string | null | undefined;
  rattsskyddNekadAt?: Date | string | null | undefined;
  hourlyRates?: HourlyRates | undefined;
}

/** Dialogens innehåll: samlar nullish-coalescingen så knappen hålls enkel (#199). */
function PaymentEditBody({ matterId, matter, onSaved }: { matterId: MatterId; matter: PaymentEditMatter; onSaved: () => void }) {
  const rattsskyddMaxOre = matter.rattsskyddMaxOre ?? null;
  const rattshjalpMaxTimmar = matter.rattshjalpMaxTimmar ?? null;
  return (
    <>
      <CoverageCapWarning matterId={matterId} paymentMethod={matter.paymentMethod}
        rattsskyddMaxOre={rattsskyddMaxOre} rattshjalpMaxTimmar={rattshjalpMaxTimmar} />
      <RattsskyddNekadBanner matterId={matterId} paymentMethod={matter.paymentMethod}
        rattsskyddNekadAt={matter.rattsskyddNekadAt} />
      <PaymentMethodCard
        matterId={matterId}
        paymentMethod={matter.paymentMethod}
        paymentMethodNote={matter.paymentMethodNote ?? null}
        paymentMethodDecidedAt={matter.paymentMethodDecidedAt ?? null}
        clientShareBips={matter.clientShareBips ?? null}
        rattsskyddMaxOre={rattsskyddMaxOre}
        rattshjalpMaxTimmar={rattshjalpMaxTimmar}
        tvistUppkomDatum={matter.tvistUppkomDatum}
        rattsskyddBeslutDatum={matter.rattsskyddBeslutDatum}
        rattsskyddNekadAt={matter.rattsskyddNekadAt}
        hourlyRates={matter.hourlyRates}
        onSaved={onSaved}
      />
    </>
  );
}

export function MatterPaymentEdit({ matterId, matter }: { matterId: MatterId; matter: PaymentEditMatter }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Ändra betalningssätt"
        className="ml-2 text-xs text-blue-600 hover:underline">
        Ändra
      </button>
      <Modal open={open} title="Betalningssätt" onClose={close}>
        <PaymentEditBody matterId={matterId} matter={matter} onSaved={close} />
      </Modal>
    </>
  );
}
