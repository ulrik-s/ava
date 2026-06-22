"use client";

/**
 * `useLeaseAwareOpen` (ADR 0033 §2) — delad öppnings-logik för träd- och list-
 * vyn så de inte glider isär. Wrappar `openDocumentSmart` och, när helpern
 * öppnade skrivskyddat (annans lease), visar `LeaseModal` med "Ta över" /
 * "Öppna ändå". Tar över via `document.takeoverLease` och öppnar om.
 */

import { useState } from "react";
import type { ModalState } from "@/components/documents/external-edit-modal";
import { LeaseModal } from "@/components/documents/lease-modal";
import type { OpenOpts } from "@/lib/client/firma/open-document-externally";
import { trpc } from "@/lib/client/trpc";

interface OpenableDoc {
  id: string;
  fileName: string;
  storagePath: string;
}

interface Pending {
  doc: OpenableDoc;
  leaseHolder?: string;
}

export interface LeaseAwareOpen {
  /** Öppna ett dokument (helper-first); visar lease-modalen vid skrivskyddat utfall. */
  openDocument: (doc: OpenableDoc, onModal: (m: ModalState) => void) => Promise<void>;
  /** Lease-modalen att rendera (null när ingen konflikt). */
  leaseModal: React.ReactElement | null;
}

export function useLeaseAwareOpen(): LeaseAwareOpen {
  const [pending, setPending] = useState<Pending | null>(null);
  const takeover = trpc.document.takeoverLease.useMutation();

  const run = async (doc: OpenableDoc, onModal: (m: ModalState) => void, opts: OpenOpts = {}): Promise<void> => {
    const { openDocumentSmart } = await import("@/lib/client/firma/open-document-externally");
    const outcome = await openDocumentSmart(doc, onModal, opts);
    if (outcome.kind === "read-only") {
      setPending({ doc, ...(outcome.leaseHolder !== undefined ? { leaseHolder: outcome.leaseHolder } : {}) });
    }
  };

  const onTakeover = async (): Promise<void> => {
    if (!pending) return;
    const { doc } = pending;
    await takeover.mutateAsync({ documentId: doc.id });
    setPending(null);
    await run(doc, () => { /* re-open: leasen är nu vår → redigerbart */ });
  };

  const onForceEdit = async (): Promise<void> => {
    if (!pending) return;
    const { doc } = pending;
    setPending(null);
    await run(doc, () => { /* lånar leasen */ }, { forceEdit: true });
  };

  const leaseModal = pending
    ? (
      <LeaseModal
        fileName={pending.doc.fileName}
        {...(pending.leaseHolder !== undefined ? { leaseHolder: pending.leaseHolder } : {})}
        busy={takeover.isPending}
        onTakeover={() => void onTakeover()}
        onForceEdit={() => void onForceEdit()}
        onClose={() => setPending(null)}
      />
    )
    : null;

  return { openDocument: (doc, onModal) => run(doc, onModal), leaseModal };
}
