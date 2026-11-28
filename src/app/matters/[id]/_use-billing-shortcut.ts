"use client";

/**
 * Genvägen "fakturera nu" utifrån (#1854): Frister-raden Bör faktureras länkar
 * till ärendet med `?fakturera=1`. Sidan gör då panelen Fakturering aktiv och
 * panelen öppnar det faktureringsflödet väljer (ADR 0034). När panelen är klar
 * tas parametern bort ur adressen, en gång, så att en omladdning, bakåtknappen
 * eller ett flikbyte inte öppnar dialogen igen.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { shellPath } from "@/lib/client/demo/entity-href";
import { BILLING_SHORTCUT_PARAM, parseBillingShortcut, type BillingActionType } from "@/lib/shared/billing/billing-flow";

/** Det {@link useBillingShortcut} ger ärendesidan. */
export interface BillingShortcutState {
  /** Adressen ber om faktureringen (`?fakturera=1`). */
  requested: boolean;
  /** `?fakturera=FINAL|ACCONTO`: öppna just den dialogen (en omgjord faktura, #2260). */
  preferred?: BillingActionType | undefined;
  /** Panelen har tagit emot begäran: ta bort parametern ur adressen (en gång). */
  done: () => void;
}

/** Läser `?fakturera=1` (eller `=FINAL`/`=ACCONTO`) på ärendesidan och tar bort den när panelen är klar. */
export function useBillingShortcut(id: string): BillingShortcutState {
  const params = useSearchParams();
  const router = useRouter();
  const replaced = useRef(false);
  const { requested, preferred } = parseBillingShortcut(params.get(BILLING_SHORTCUT_PARAM));
  // En ny begäran (t.ex. ett nytt klick i ärendets egen Frister) tas bort igen.
  useEffect(() => { if (!requested) replaced.current = false; }, [requested]);
  const done = useCallback(() => {
    if (replaced.current) return;
    replaced.current = true;
    router.replace(shellPath("matters", id));
  }, [router, id]);
  return { requested, preferred, done };
}
