"use client";

/**
 * "Att åtgärda" (#1734) — det som kräver ett beslut, inte en frist: takvarningar
 * för rättshjälp och rättsskydd, jävskontroller med träffar som ingen har bedömt,
 * aktiva ärenden utan tid på två månader som kanske ska avslutas (#2100),
 * avbetalningar där klienten ligger efter (#2137), och synkrutorna. Posterna är härledda och försvinner när de är åtgärdade.
 * Samma uppbyggnad som sidan Att bevaka (`@/app/watchlist/page`).
 */

import { useState } from "react";
import { ListPage } from "@/components/layout/list-page";
import { useMatterStatusActions } from "@/components/matter/use-matter-status-actions";
import { RejectedChangesNotice } from "@/components/sync/rejected-changes-notice";
import { StaleDevicesNotice } from "@/components/sync/stale-devices-notice";
import { WatchlistList } from "@/components/watchlist/watchlist-list";
import { trpc } from "@/lib/client/trpc";

export default function ActionItemsPage() {
  const [mine, setMine] = useState(true);
  const q = trpc.watchlist.actionItems.useQuery({ mine });
  const items = q.data?.items ?? [];
  const closeActions = useMatterStatusActions();

  return (
    <ListPage
      header={(
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Att åtgärda</h1>
            <p className="text-sm text-gray-500">
              {q.isLoading ? "Hämtar…" : `${items.length} poster.`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="rounded border-gray-300"
            />
            Bara mina ärenden
          </label>
        </div>
      )}
    >
      <RejectedChangesNotice />
      <StaleDevicesNotice />
      <WatchlistList items={items} emptyText="Inget att åtgärda just nu." closeActions={closeActions} />
    </ListPage>
  );
}
