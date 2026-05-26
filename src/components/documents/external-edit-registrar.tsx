"use client";

/**
 * `ExternalEditRegistrar` — mountar singleton-tracker:n vid app-boot.
 * Routar commit-callbacks till `document.markExternallyEdited` så bytes
 * versionerar via git.
 */

import { useEffect } from "react";
import { ExternalEditTracker, setExternalEditTracker, type CommitPayload } from "@/lib/client/fsa/external-edit-tracker";
import { trpc } from "@/lib/client/trpc";

export function ExternalEditRegistrar(): null {
  const utils = trpc.useUtils();

  useEffect(() => {
    const tracker = new ExternalEditTracker({
      pollIntervalMs: 2000,
      debounceMs: 90_000,
      onCommit: async (p: CommitPayload) => {
        try {
          await utils.client.document.markExternallyEdited.mutate({
            id: p.docId,
            saves: p.saves,
            sessionStartedAt: new Date(p.sessionStartedAt).toISOString(),
            sizeBytes: p.bytes.byteLength,
          });
          await utils.document.tree.invalidate();
        } catch (err) {
          console.error("[external-edit] commit misslyckades", p.path, err);
        }
      },
    });
    setExternalEditTracker(tracker);
    return () => {
      tracker.dispose();
      setExternalEditTracker(null);
    };
  }, [utils]);

  return null;
}
