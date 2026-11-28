"use client";

/**
 * `LedgerReconnectBanner` (#1816) — gul remsa på alla sidor när
 * bokföringssystemet har avvisat förnyelsen av anslutningen (#1814). Bara
 * administratören ser den, eftersom bara hen kan ansluta igen. Den går inte
 * att stänga: den försvinner när anslutningen är gjord (statusen invalideras
 * efter anslutningen). I demon är statusfrågan avstängd, så där syns den aldrig.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useLedgerStatus } from "@/lib/client/backend/server-ledger";
import { useTRPC } from "@/lib/client/trpc";

export function LedgerReconnectBanner() {
  const status = useLedgerStatus();
  const t = useTRPC();
  const me = useQuery(t.user.current.queryOptions());
  if (status.data?.reconnectRequired !== true || me.data?.role !== "ADMIN") return null;
  return (
    <div role="alert" data-testid="ledger-reconnect-banner" className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
      <span>Fortnox-anslutningen har gått ut. Bokföringen till Fortnox fungerar inte förrän du ansluter igen.</span>
      <Link
        href="/settings#ledger"
        className="shrink-0 rounded border border-amber-400 bg-white px-2 py-0.5 font-medium hover:bg-amber-100"
      >
        Anslut igen
      </Link>
    </div>
  );
}
