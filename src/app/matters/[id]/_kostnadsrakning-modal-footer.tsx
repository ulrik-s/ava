"use client";

/**
 * Kostnadsräkningsmodalens nederdel (utbruten ur `_kostnadsrakning-modal.tsx`,
 * #1891): helper-statusen, fel- och klarmeddelandena och knapparna.
 */
import { AlertTriangle, Save } from "lucide-react";
import type { useHelper } from "@/lib/client/helper/use-helper";

type HelperState = ReturnType<typeof useHelper>;

/** Helper-status-noten (mail-app-integration). */
export function HelperStatusNote({ helper }: { helper: HelperState }) {
  return (
    <section className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
      {helper.checked && helper.version
        ? <>✓ AVA Helper {helper.version} installerad — mail-appen öppnas med bilaga efter generering.</>
        : helper.checked
          ? <>Helper ej installerad — dokumentet sparas i ärendet, du kan skicka mail manuellt därifrån.</>
          : <>Kontrollerar helper-status…</>}
    </section>
  );
}

/** Fel- och klar-meddelanden. */
export function StatusMessages({ error, done }: { error: string | null; done: { filename: string; mailOpened: boolean } | null }) {
  return (
    <>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle size={12} className="inline mr-1" /> {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded p-3">
          ✓ <strong>{done.filename}</strong> sparad i ärendets dokument.
          {done.mailOpened
            ? <> Mail-appen öppnas med kostnadsräkningen som bilaga — fyll i adressaten och skicka.</>
            : <> Bifoga manuellt när du skickar mail till rätten.</>}
        </p>
      )}
    </>
  );
}

/** Footer: avbryt/stäng + generera-knappen. */
export function ModalFooter({ done, generating, blocked, helperVersion, onClose, onGenerate }: {
  done: boolean; generating: boolean;
  /** Inte redo: posterna läses in, eller förhandlingen saknar tid. */
  blocked: boolean;
  helperVersion: HelperState["version"]; onClose: () => void; onGenerate: () => void;
}) {
  return (
    <div className="border-t border-gray-200 px-4 sm:px-6 py-3 bg-gray-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sticky bottom-0">
      <button onClick={onClose}
        className="text-sm text-gray-600 hover:text-gray-900 py-2 px-3 order-2 sm:order-1">
        {done ? "Stäng" : "Avbryt"}
      </button>
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating || blocked}
        className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 text-white text-base font-semibold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2 touch-manipulation order-1 sm:order-2"
      >
        {generating ? (
          <>Genererar…</>
        ) : (
          <>
            <Save size={18} />
            {helperVersion ? "Generera + öppna mail" : "Generera + spara"}
          </>
        )}
      </button>
    </div>
  );
}
