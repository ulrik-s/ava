"use client";

/**
 * `AnalyzeDispatcherRegistrar` — registrerar en callback från
 * job-worker:n till tRPC:s document.updateMetadata. Mountas en gång
 * i DemoBootstrap-trädet under tRPC-providern.
 */

import { useEffect } from "react";
import { trpc } from "@/client/lib/trpc";
import { setAnalyzeDispatcher } from "@/client/lib/jobs/analyze-dispatch";

export function AnalyzeDispatcherRegistrar() {
  const updateMetadata = trpc.document.updateMetadata.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    setAnalyzeDispatcher(async ({ documentId, kind, analyzedAt, analysisStatus }) => {
      await updateMetadata.mutateAsync({
        documentId,
        documentType: kind,
        analyzedAt,
        analysisStatus,
      });
      // Invalidera så document-tree i UI:n re-fetchar med uppdaterad metadata
      await utils.document.tree.invalidate();
    });
    return () => setAnalyzeDispatcher(null);
  }, [updateMetadata, utils]);

  return null;
}
