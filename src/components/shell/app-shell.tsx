"use client";

/**
 * `AppShell` — full-höjds layout med Sidebar + main. Wrapper:n hämtar
 * inloggad användare via `user.current` så Sidebar:s userName-prop
 * visar rätt namn.
 *
 * SOLID: shell:n ansvarar bara för layouten — auth/data-state hör hemma
 * uppåt i `DemoBootstrap`. /demo har egen runtime så skippas härifrån.
 */

import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { ExternalEditIndicator } from "@/components/documents/external-edit-indicator";
import { ExternalEditRegistrar } from "@/components/documents/external-edit-registrar";
import { useTRPC } from "@/lib/client/trpc";
import { DemoModeBanner } from "./demo-mode-banner";
import { LedgerReconnectBanner } from "./ledger-reconnect-banner";
import { ReleaseNotesOnUpdate } from "./release-notes";
import { Sidebar } from "./sidebar";

/**
 * Routes som ska renderas utan sidebar (deras egen layout tar över).
 * Tomt just nu — /demo har egen path-detektion i DemoBootstrap.
 */
const FULLSCREEN_ROUTES: readonly string[] = [];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTRPC();
  const current = useQuery(t.user.current.queryOptions(undefined, { staleTime: 60_000, retry: false }));

  if (FULLSCREEN_ROUTES.includes(pathname ?? "")) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col h-full">
      <ExternalEditRegistrar />
      <DemoModeBanner />
      <LedgerReconnectBanner />
      <ExternalEditIndicator />
      <ReleaseNotesOnUpdate />
      {/* Telefon: toppremsan (i flödet) staplas ovanför main (#1297). Från 768 px
          står menyn — ikonmenyn eller hela sidomenyn — till vänster (#1301). */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <Sidebar userName={current.data?.name ?? null} />
        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
