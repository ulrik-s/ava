"use client";

/**
 * `/sync-conflicts` — ändringar servern avvisade (#1266). Serverns läge gäller
 * redan lokalt; här bestämmer juristen om ändringen ska göras om eller kastas.
 */

import { ListPage } from "@/components/layout/list-page";
import { RejectedChangesList } from "@/components/sync/rejected-changes-list";
import { rejectedChanges } from "@/lib/client/backend/rejected-changes";
import { useRejectedChanges } from "@/lib/client/sync/use-rejected-changes";

export default function SyncConflictsPage() {
  const items = useRejectedChanges();
  return (
    <ListPage
      header={(
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Avvisade ändringar</h1>
          <p className="text-sm text-gray-500">
            Ändringar du gjorde som servern inte godtog. Det som gäller på servern visas redan i AVA.
            Rätta det som stoppade ändringen och välj <strong>Försök igen</strong>, eller <strong>Kasta</strong> den.
          </p>
        </div>
      )}
    >
      <RejectedChangesList
        items={items}
        onRetry={(id) => rejectedChanges.retry(id)}
        onDiscard={(id) => rejectedChanges.discard(id)}
      />
    </ListPage>
  );
}
