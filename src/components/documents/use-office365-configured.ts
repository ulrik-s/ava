"use client";

/**
 * Finns en Office 365-konfiguration för webbappen? (#1951, #1949)
 *
 * Slås upp en gång per sidladdning och delas av alla dokumentrader: en fråga
 * med fast nyckel och `staleTime: Infinity`, så att också svaret `null` (ingen
 * server, demon) delas. `serverOffice365Config` sparar inte `null` och hade
 * annars frågat servern igen för varje rad.
 */

import { useQuery } from "@tanstack/react-query";
import { resolveOffice365Config, serverOffice365Config } from "@/lib/client/integrations/office365-config";

/** Frågans nyckel, delad av alla rader. */
export const OFFICE365_CONFIG_QUERY_KEY = ["office365", "config"] as const;

/** Sant när konfigurationen finns. Falskt medan den slås upp, och utan den. */
export function useOffice365Configured(): boolean {
  const q = useQuery({
    queryKey: OFFICE365_CONFIG_QUERY_KEY,
    queryFn: () => resolveOffice365Config(serverOffice365Config),
    staleTime: Infinity,
  });
  return q.data != null;
}
