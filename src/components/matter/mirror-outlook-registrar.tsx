"use client";

/**
 * Registrar för mirror-to-outlook-workern:
 *   1. Token-provider — hämtar Microsoft Graph access-token. För nu:
 *      - Letar i localStorage.getItem("ava.outlookToken") (manuell paste i settings)
 *      - Fallback: registry-connectorn "office365" om den är `connected`
 *      Returnerar null om ingen källa är tillgänglig — workern markerar
 *      då eventet som mirror-failed med ett user-facing meddelande.
 *
 *   2. Mirror-state-dispatcher — uppdaterar calendar-eventet via
 *      `trpc.calendar.setMirrorState`-mutation (bypassar mirrorPatch-loop).
 */

import { useEffect } from "react";
import {
  setMirrorStateDispatcher,
  setOutlookTokenProvider,
} from "@/lib/client/jobs/mirror-outlook-dispatch";
import { trpc } from "@/lib/client/trpc";

export function MirrorOutlookRegistrar() {
  const setMirror = trpc.calendar.setMirrorState.useMutation();

  useEffect(() => {
    setOutlookTokenProvider(async () => {
      // 1. Manuell token paste:ad i settings (samma mönster som GitHub PAT)
      const manual = typeof window !== "undefined" ? localStorage.getItem("ava.outlookToken") : null;
      if (manual) return manual;
      // 2. O365-connector via registry (stub tills MSAL är inlagd)
      try {
        const { getConnector } = await import("@/lib/client/integrations/registry");
        const conn = getConnector("office365");
        if (!conn) return null;
        const status = await conn.getStatus();
        if (status.kind !== "connected") return null;
        return await conn.getAccessToken();
      } catch { return null; }
    });

    setMirrorStateDispatcher(async ({ eventId, patch }) => {
      await setMirror.mutateAsync({
        id: eventId,
        outlookEventId: patch.outlookEventId ?? null,
        mirrorStatus: patch.mirrorStatus,
        mirrorError: patch.mirrorError ?? null,
        mirrorLastSyncedAt: patch.mirrorLastSyncedAt ?? null,
      });
    });

    return () => {
      setOutlookTokenProvider(null);
      setMirrorStateDispatcher(null);
    };
  // setMirror är stabil; mutation-objektet är samma över renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
