"use client";

/**
 * `useMatterInvariants` — kör per-ärende-invarianterna ([[invariants]]) mot
 * ärendets billing-runs + dokument och rapporterar överträdelser till
 * issue-storen ([[issue-store]]). Monteras i ärende-/billing-vyn.
 *
 * Hämtningen återanvänder samma tRPC-queries som billing-panelen redan kör
 * (react-query dedupar), så ingen extra nätverkstrafik tillkommer.
 */

import { useEffect } from "react";
import { trpc } from "@/lib/client/trpc";
import { detectMatterInvariants, type BillingRunView, type DocumentView } from "@/lib/shared/diagnostics/invariants";
import { reportSelfDetected } from "@/lib/client/diagnostics";
import { omitUndefined } from "@/lib/shared/omit-undefined";

export function useMatterInvariants(input: { matterId: string; matterNumber?: string }): void {
  const { matterId, matterNumber } = input;
  const runs = trpc.billingRun.list.useQuery({ matterId });
  const docs = trpc.document.list.useQuery({ matterId, folderId: null, pageSize: 100 });

  const runRows = runs.data?.runs as ReadonlyArray<BillingRunView> | undefined;
  const docRows = docs.data?.documents as ReadonlyArray<DocumentView> | undefined;

  useEffect(() => {
    if (!runRows || !docRows) return;
    reportSelfDetected(
      detectMatterInvariants({
        matterId,
        ...omitUndefined({ matterNumber }),
        billingRuns: runRows,
        documents: docRows,
      }),
    );
  }, [matterId, matterNumber, runRows, docRows]);
}
