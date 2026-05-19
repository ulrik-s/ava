/**
 * `DemoModeContext` — React-kontext som signalerar "appen kör i
 * read-only demo-läge". Komponenter konsulterar `useIsReadOnly()`
 * för att gråa knappar, dölja formulär eller visa tooltip:s.
 *
 * Designval (Single responsibility):
 *   - Bara en boolean. Inget data-hämtnings-ansvar.
 *
 * Designval (Open-closed):
 *   - Komponenter som vill respektera read-only opt:ar in via
 *     `useIsReadOnly()`. Inga obligatoriska ändringar någonstans.
 *
 * Designval (SSR-säker):
 *   - Default false → server-render fungerar oförändrat. Provider:n
 *     sätter true bara i demo-builds.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";

const DemoModeContext = createContext<boolean>(false);

export function DemoModeProvider({
  readOnly = true,
  children,
}: {
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <DemoModeContext.Provider value={readOnly}>
      {children}
    </DemoModeContext.Provider>
  );
}

/**
 * Hook: returnerar `true` när appen kör i demo/read-only-läge.
 *
 * Användning:
 *   const readOnly = useIsReadOnly();
 *   <button disabled={readOnly} title={readOnly ? "Demo-läge — read-only" : undefined}>
 *     Skapa
 *   </button>
 */
export function useIsReadOnly(): boolean {
  return useContext(DemoModeContext);
}
