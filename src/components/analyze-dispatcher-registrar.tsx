"use client";

/**
 * `AnalyzeDispatcherRegistrar` — registrerar en callback från
 * job-worker:n till tRPC:s document.updateMetadata. Mountas en gång
 * i DemoBootstrap-trädet under tRPC-providern.
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { setAnalyzeDispatcher } from "@/lib/jobs/analyze-dispatch";

export function AnalyzeDispatcherRegistrar() {
  const updateMetadata = trpc.document.updateMetadata.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    setAnalyzeDispatcher(async ({ documentId, kind }) => {
      await updateMetadata.mutateAsync({ documentId, documentType: kind });
      // Invalidera så document-tree i UI:n re-fetchar med uppdaterad metadata
      await utils.document.tree.invalidate();
    });
    return () => setAnalyzeDispatcher(null);
  }, [updateMetadata, utils]);

  return null;
}
