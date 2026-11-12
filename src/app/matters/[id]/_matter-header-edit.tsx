"use client";

/**
 * "Ändra" i ärendehuvudet (#1565): ETT sätt att ändra ärendets uppgifter.
 * Dialogen har ärendeuppgifterna och hela betalningsdelen (med takvarning och
 * nekat-banner), och en enda "Spara" gör ett `matter.update`. Ersätter
 * betalningssättets egen dialog (#1499). Innehållet är utbrutet ur knappen
 * för komplexiteten (#199) och monteras först när dialogen öppnas, så att
 * fälten alltid startar från ärendets sparade uppgifter.
 */

import { useState } from "react";
import { CoverageCapWarning } from "@/components/matter/coverage-cap-warning";
import { PaymentMethodFields } from "@/components/matter/payment-method-fields";
import { RattsskyddNekadBanner } from "@/components/matter/rattsskydd-nekad-banner";
import { usePaymentMethodForm, type PaymentMethodInitial } from "@/components/matter/use-payment-method-form";
import { Modal } from "@/components/ui/modal";
import { invalidateBillingSideEffects } from "@/lib/client/billing/invalidate-billing-side-effects";
import { trpc } from "@/lib/client/trpc";
import { hasInsuranceCompany, type MatterContactWithRole } from "@/lib/shared/matter-insurance";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { MatterDetailsFields } from "./_matter-details-fields";
import {
  canSaveMatterDetails, matterDetailsFromMatter, matterDetailsInput, type MatterDetailsInitial,
} from "./_matter-edit-input";

type DateLike = Date | string | null | undefined;

/** Ärendet som dialogen ändrar, som det kommer från `matter.getById`. */
export interface HeaderEditMatter extends MatterDetailsInitial {
  paymentMethod: PaymentMethod;
  paymentMethodNote?: string | null | undefined;
  paymentMethodDecidedAt?: DateLike;
  clientShareBips?: number | null | undefined;
  rattsskyddMaxOre?: number | null | undefined;
  rattshjalpMaxTimmar?: number | null | undefined;
  tvistUppkomDatum?: DateLike;
  rattsskyddBeslutDatum?: DateLike;
  rattsskyddNekadAt?: DateLike;
  hourlyRates?: HourlyRates | undefined;
}

interface EditProps {
  matterId: MatterId;
  matter: HeaderEditMatter;
  /** Ärendets kontakter — styr om försäkringsreferensen visas. */
  contacts: readonly MatterContactWithRole[];
}

/** Takvarning och nekat-banner överst i dialogen, som i den tidigare betalningsdialogen. */
function PaymentNotices({ matterId, matter }: Omit<EditProps, "contacts">) {
  return (
    <>
      <CoverageCapWarning matterId={matterId} paymentMethod={matter.paymentMethod}
        rattsskyddMaxOre={matter.rattsskyddMaxOre ?? null} rattshjalpMaxTimmar={matter.rattshjalpMaxTimmar ?? null} />
      <RattsskyddNekadBanner matterId={matterId} paymentMethod={matter.paymentMethod}
        rattsskyddNekadAt={matter.rattsskyddNekadAt} />
    </>
  );
}

/** Ärendets betalningsuppgifter med null i stället för saknade värden. */
function paymentInitial(m: HeaderEditMatter): PaymentMethodInitial {
  return {
    ...m,
    paymentMethodNote: m.paymentMethodNote ?? null,
    paymentMethodDecidedAt: m.paymentMethodDecidedAt ?? null,
    clientShareBips: m.clientShareBips ?? null,
    rattsskyddMaxOre: m.rattsskyddMaxOre ?? null,
    rattshjalpMaxTimmar: m.rattshjalpMaxTimmar ?? null,
  };
}

/** Dialogens formulär: fälten, Avbryt och den enda Spara. */
function MatterEditForm({ matterId, matter, contacts, onClose }: EditProps & { onClose: () => void }) {
  const [details, setDetails] = useState(() => matterDetailsFromMatter(matter));
  const payment = usePaymentMethodForm(paymentInitial(matter));
  const matterTypes = trpc.organization.getSettings.useQuery().data?.matterTypes ?? [];
  const showInsuranceReference = hasInsuranceCompany(contacts);
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => {
      void utils.matter.getById.invalidate({ id: matterId });
      invalidateBillingSideEffects(utils);
      onClose();
    },
  });
  const save = () => update.mutate({
    id: matterId,
    ...matterDetailsInput(details, { matterTypes, showInsuranceReference }),
    ...payment.toUpdateInput(),
  });
  return (
    <div className="space-y-4">
      <PaymentNotices matterId={matterId} matter={matter} />
      <MatterDetailsFields value={details} onChange={setDetails} matterTypes={matterTypes}
        showInsuranceReference={showInsuranceReference} />
      <PaymentMethodFields value={payment.values} onChange={payment.setValues} />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
          Avbryt
        </button>
        <button type="button" disabled={update.isPending || !canSaveMatterDetails(details)} onClick={save}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {update.isPending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </div>
  );
}

/** Knappen "Ändra" i ärendehuvudet och dialogen den öppnar. */
export function MatterHeaderEdit(props: EditProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Ändra ärende"
        className="ml-2 text-xs text-blue-600 hover:underline">
        Ändra
      </button>
      <Modal open={open} title="Ändra ärende" onClose={close} widthClass="max-w-2xl">
        <div className="max-h-[75vh] overflow-y-auto">
          <MatterEditForm {...props} onClose={close} />
        </div>
      </Modal>
    </>
  );
}
