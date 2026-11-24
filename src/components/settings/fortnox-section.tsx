"use client";

/**
 * Fortnox-anslutning (#1172). Administratören skickas till Fortnox för att
 * godkänna; Fortnox skickar tillbaka till `/settings/fortnox` som slutför.
 * Döljs helt när servern saknar Fortnox-konfiguration (och i demo).
 *
 * Tre lägen (#1816): ansluten (med senaste förnyelsen och ungefär när den går
 * ut), måste anslutas igen (Fortnox godtog inte förnyelsen) och inte ansluten.
 */

import { SECTION_CARD_CLASS } from "@/components/ui/section-tone";
import { useConnectLedger, useLedgerStatus } from "@/lib/client/backend/server-ledger";
import { trpc } from "@/lib/client/trpc";
import { stockholmDay } from "@/lib/shared/stockholm-time";

interface StatusFields {
  connected: boolean;
  reconnectRequired: boolean;
  renewedAt: Date | null;
  expiresAt: Date | null;
}

/** "Senast förnyad … · går ut ca …", eller `null` när förnyelsen inte är känd. */
function renewalText({ renewedAt, expiresAt }: StatusFields): string | null {
  if (!renewedAt || !expiresAt) return null;
  return `Senast förnyad ${stockholmDay(renewedAt)} · går ut ca ${stockholmDay(expiresAt)}`;
}

function StatusLine({ status }: { status: StatusFields }) {
  if (status.reconnectRequired) {
    return (
      <>
        <p className="text-sm">Fortnox: <span className="text-red-700 font-medium">måste anslutas igen</span></p>
        <p className="mt-1 text-xs text-red-700">
          Fortnox godtog inte förnyelsen. Bokföringen till Fortnox fungerar inte förrän en administratör ansluter igen.
        </p>
      </>
    );
  }
  if (!status.connected) return <p className="text-sm">Fortnox: <span className="text-gray-600">inte ansluten</span></p>;
  const renewal = renewalText(status);
  return (
    <>
      <p className="text-sm">Fortnox: <span className="text-green-700 font-medium">ansluten ✓</span></p>
      {renewal && <p className="mt-1 text-xs text-gray-600">{renewal}</p>}
    </>
  );
}

export function FortnoxSection() {
  const status = useLedgerStatus();
  const me = trpc.user.current.useQuery();
  const connect = useConnectLedger();

  if (!status.data?.configured) return null;
  const hasConnected = status.data.connected || status.data.reconnectRequired;
  return (
    <div className={SECTION_CARD_CLASS}>
      <StatusLine status={status.data} />
      <p className="mt-1 text-xs text-gray-500">
        Utställda fakturor bokförs som verifikat mot kontona nedan (knappen &quot;Bokför i Fortnox&quot; på fakturan).
      </p>
      {me.data?.role === "ADMIN" && (
        <button
          type="button"
          disabled={connect.isPending}
          onClick={() => connect.mutate()}
          className="mt-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {hasConnected ? "Anslut igen" : "Anslut Fortnox"}
        </button>
      )}
      {connect.error && <p role="alert" className="mt-2 text-sm text-red-700">{connect.error.message}</p>}
    </div>
  );
}
