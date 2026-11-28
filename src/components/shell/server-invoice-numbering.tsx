"use client";

/**
 * `ServerInvoiceNumbering` (#1243) — self-hosted: fakturanumret sätts av
 * servern, så fakturadokument skapas först när numret är fastställt. Kopplar
 * resolvern mot klientstoren och kör uppskjutna dokument efter varje synk.
 * Renderar ingenting.
 */

import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import type { InvoiceNumberFields } from "@/lib/client/billing/invoice-number-finality";
import { startServerInvoiceNumbering } from "@/lib/client/billing/server-invoice-numbering";
import { useBillingQueryUtils } from "@/lib/client/billing/use-billing-query-utils";
import { useTRPC } from "@/lib/client/trpc";

/** Det komponenten läser ur klientstoren (`CachingSyncDataStore` uppfyller det). */
export interface InvoiceNumberingSource {
  hasPendingFor(entity: string, id: string): boolean;
  store: { invoices: { findUnique(args: { where: { id: string } }): Promise<InvoiceNumberFields | null> } };
}

/** Kopplar serverns fakturanumrering mot klientstoren; `null` under uppstart. */
export function ServerInvoiceNumbering({ store }: { store: InvoiceNumberingSource | null }) {
  const t = useTRPC();
  const register = useMutation(t.document.register.mutationOptions());
  const utils = useBillingQueryUtils();
  const { mutateAsync } = register;

  useEffect(() => {
    if (!store) return;
    return startServerInvoiceNumbering({
      store: {
        hasPendingFor: (entity, id) => store.hasPendingFor(entity, id),
        readInvoice: (id) => store.store.invoices.findUnique({ where: { id } }),
      },
      register: { mutateAsync },
      utils,
    });
  }, [store, mutateAsync, utils]);

  return null;
}
