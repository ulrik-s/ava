"use client";

/**
 * `LeaseModal` (ADR 0033 §2) — visas när helpern öppnade ett dokument
 * skrivskyddat för att någon annan redigerar det (håller leasen). Ger
 * juristen tre tydliga val på klarspråk, utan teknisk jargong:
 *
 *   - Behåll skrivskyddat (säkrast, default-knappen).
 *   - Ta över redigeringen → omtilldelar leasen permanent (den andra blir
 *     skrivskyddad). För när hen "verkar inte redigera längre".
 *   - Öppna ändå för redigering → lånar (redigerar parallellt); krockar löses
 *     genom att din version sparas separat (keep-both, §4).
 *
 * Dum komponent: actions injiceras (`useLeaseAwareOpen` äger mutation + re-open).
 */

interface Props {
  fileName: string;
  leaseHolder?: string;
  busy?: boolean;
  onTakeover: () => void;
  onForceEdit: () => void;
  onClose: () => void;
}

const PRIMARY = "px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50";
const SECONDARY = "px-3 py-1.5 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50";

export function LeaseModal({ fileName, leaseHolder, busy, onTakeover, onForceEdit, onClose }: Props): React.ReactElement {
  const who = leaseHolder ?? "Någon annan";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{who} redigerar det här dokumentet</h2>
        <p className="text-sm text-gray-700 mb-4">
          <code className="text-sm bg-gray-100 px-1 rounded">{fileName}</code> öppnades
          {" "}<strong>skrivskyddat</strong> så att era ändringar inte krockar.
        </p>

        <div className="space-y-3 mb-2">
          <div>
            <button type="button" onClick={onClose} disabled={busy} className={PRIMARY}>
              Behåll skrivskyddat
            </button>
            <p className="text-xs text-gray-500 mt-1">Säkrast — du tittar utan att riskera att skriva över {who}s arbete.</p>
          </div>
          <div>
            <button type="button" onClick={onTakeover} disabled={busy} className={SECONDARY}>
              {busy ? "Tar över…" : "Ta över redigeringen"}
            </button>
            <p className="text-xs text-gray-500 mt-1">
              Gör dig till den som redigerar (om {who} inte verkar jobba längre). {who} blir då skrivskyddad.
            </p>
          </div>
          <div>
            <button type="button" onClick={onForceEdit} disabled={busy} className={SECONDARY}>
              Öppna ändå för redigering
            </button>
            <p className="text-xs text-gray-500 mt-1">
              Ni redigerar parallellt. Krockar hanteras automatiskt — din version sparas då separat, inget går förlorat.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
