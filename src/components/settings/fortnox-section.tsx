"use client";

/**
 * Fortnox-anslutning (#1172). Administratören skickas till Fortnox för att
 * godkänna; Fortnox skickar tillbaka till `/settings/fortnox` som slutför.
 * Döljs helt när servern saknar Fortnox-konfiguration (och i demo).
 */

import { trpc } from "@/lib/client/trpc";

export function FortnoxSection() {
  const status = trpc.ledger.status.useQuery();
  const me = trpc.user.current.useQuery();
  const connect = trpc.ledger.connectUrl.useMutation({
    onSuccess: ({ url }) => { window.location.assign(url); },
  });

  if (!status.data?.configured) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <p className="text-sm">
        Fortnox: {status.data.connected ? <span className="text-green-700 font-medium">ansluten ✓</span> : <span className="text-gray-600">inte ansluten</span>}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Utställda fakturor bokförs som verifikat mot kontona nedan (knappen &quot;Bokför i Fortnox&quot; på fakturan).
      </p>
      {me.data?.role === "ADMIN" && (
        <button
          type="button"
          disabled={connect.isPending}
          onClick={() => connect.mutate()}
          className="mt-3 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {status.data.connected ? "Anslut igen" : "Anslut Fortnox"}
        </button>
      )}
      {connect.error && <p role="alert" className="mt-2 text-sm text-red-700">{connect.error.message}</p>}
    </div>
  );
}
