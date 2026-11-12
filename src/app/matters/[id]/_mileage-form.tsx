"use client";

/**
 * Milersättning som utlägg i ärendet (#1529). Juristen anger resan och får ett
 * vanligt debiterbart utlägg där beloppet är mil × kr/mil. Kr/mil förifylls ur
 * juristens profil (#1527) men kan ändras för just den här resan.
 */

import { useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import {
  mileageAmountOre, mileageExpensePayload, mileageRateKrPerMil, type MileageExpensePayload, type MileageTrip,
} from "@/lib/shared/mileage-rate";
import { VatPreview } from "./_vat-preview";

/** Formulärets värden; `krPerMil` undefined = orört, följer profilen. */
interface MileageFormState {
  date: string;
  from: string;
  to: string;
  mil: number | null;
  krPerMil: number | null | undefined;
}

interface Props {
  isPending: boolean;
  onSubmit: (payload: MileageExpensePayload) => void;
  onCancel: () => void;
}

const INPUT_CLASS = "w-full rounded border border-gray-300 px-3 py-1.5 text-sm";
const LABEL_CLASS = "block text-xs text-gray-500 mb-1";

function initialState(): MileageFormState {
  return { date: new Date().toISOString().split("T")[0] ?? "", from: "", to: "", mil: null, krPerMil: undefined };
}

/** Komplett resa, eller null så länge något fält saknas. */
function tripOf(s: MileageFormState, krPerMil: number | null): MileageTrip | null {
  if (!s.date || !s.from.trim() || !s.to.trim() || !s.mil || !krPerMil) return null;
  return { date: s.date, from: s.from.trim(), to: s.to.trim(), mil: s.mil, krPerMil };
}

export function MileageForm({ isPending, onSubmit, onCancel }: Props) {
  const me = trpc.user.current.useQuery();
  const [state, setState] = useState<MileageFormState>(initialState);
  const krPerMil = state.krPerMil === undefined ? mileageRateKrPerMil(me.data?.mileageRate) : state.krPerMil;
  const trip = tripOf(state, krPerMil);
  const amountOre = trip ? mileageAmountOre(trip.mil, trip.krPerMil) : 0;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (trip) onSubmit(mileageExpensePayload(trip)); }} className="space-y-3">
      <div>
        <label htmlFor="mileage-date" className={LABEL_CLASS}>Datum *</label>
        <input id="mileage-date" type="date" required value={state.date} className={INPUT_CLASS}
          onChange={(e) => setState({ ...state, date: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="mileage-from" className={LABEL_CLASS}>Från *</label>
          <input id="mileage-from" type="text" required value={state.from} className={INPUT_CLASS}
            onChange={(e) => setState({ ...state, from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="mileage-to" className={LABEL_CLASS}>Till *</label>
          <input id="mileage-to" type="text" required value={state.to} className={INPUT_CLASS}
            onChange={(e) => setState({ ...state, to: e.target.value })} />
        </div>
        <div>
          <label htmlFor="mileage-mil" className={LABEL_CLASS}>Antal mil *</label>
          <DecimalInput id="mileage-mil" value={state.mil} placeholder="0,0" className={INPUT_CLASS}
            onChange={(mil) => setState({ ...state, mil })} />
        </div>
        <div>
          <label htmlFor="mileage-rate" className={LABEL_CLASS}>Kr/mil *</label>
          <DecimalInput id="mileage-rate" value={krPerMil} className={INPUT_CLASS}
            onChange={(v) => setState({ ...state, krPerMil: v })} />
        </div>
      </div>
      <p className="text-sm text-gray-700">Summa: <span className="font-mono">{formatCurrency(amountOre)}</span></p>
      <VatPreview amount={amountOre / 100} vatRate={0} passThrough={false} />
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Avbryt
        </button>
        <button type="submit" disabled={isPending || !trip}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Sparar..." : "Spara"}
        </button>
      </div>
    </form>
  );
}
