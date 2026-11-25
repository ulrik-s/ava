"use client";

/**
 * `MoveToMatterDialog` — flytta något till ett annat ärende (#2043).
 *
 * Generell: dialogen vet inte vad som flyttas, bara hur många (`count`) och vad
 * de kallas (`noun`, t.ex. "tidsposter" eller "dokument"). Sidan gör flytten i
 * `onMove` med det valda ärendets id. Fält som bara gäller en sorts flytt läggs
 * som `children` under ärendet.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { MatterCombobox, type MatterOption } from "./matter-combobox";

/** Props för `MoveToMatterDialog`. */
export interface MoveToMatterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Hur många som flyttas. */
  count: number;
  /** Vad de kallas i plural, t.ex. "tidsposter". */
  noun: string;
  /** Ärendena som går att välja (aktiva ärenden). */
  matters: readonly MatterOption[];
  /** Ärendet de redan ligger i: inte valbart. */
  excludeMatterId?: MatterId | undefined;
  /** Flytta till det valda ärendet. */
  onMove: (matterId: MatterId) => void;
  /** Flytten pågår: **Flytta** är avstängd. */
  isPending?: boolean | undefined;
  /** Varför flytten misslyckades, om den gjorde det. */
  error?: string | null | undefined;
  /** Fält under ärendet. */
  children?: React.ReactNode;
}

/** Dialogen "N <noun> flyttas till:" med ärendeväljaren och knapparna Flytta och Avbryt. */
export function MoveToMatterDialog(props: MoveToMatterDialogProps): React.ReactElement | null {
  const { open, onClose, count, noun, excludeMatterId, onMove, isPending, error, children } = props;
  const [matterId, setMatterId] = useState<MatterId>(asId<"MatterId">(""));
  const choices = props.matters.filter((m) => m.id !== excludeMatterId);
  const close = (): void => { setMatterId(asId<"MatterId">("")); onClose(); };
  return (
    <Modal open={open} title="Flytta till ärende" onClose={close}>
      <form onSubmit={(e) => { e.preventDefault(); if (matterId !== "") onMove(matterId); }} className="space-y-4">
        <MatterCombobox label={`${count} ${noun} flyttas till:`} required matters={choices}
          value={matterId} onChange={setMatterId} />
        {children}
        {error && <p role="alert" className="text-sm text-red-700">Kunde inte flytta: {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Avbryt</button>
          <button type="submit" disabled={matterId === "" || isPending === true}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Flytta
          </button>
        </div>
      </form>
    </Modal>
  );
}
