"use client";

/**
 * `AppShell` — full-höjds layout med Sidebar + main. Wrapper:n hämtar
 * inloggad användare via `trpc.user.current` så Sidebar:s userName-prop
 * visar rätt namn.
 *
 * SOLID: shell:n ansvarar bara för layouten — auth/data-state hör hemma
 * uppåt i `DemoBootstrap`. /demo har egen runtime så skippas härifrån.
 */

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { DemoModeBanner } from "./demo-mode-banner";
import { trpc } from "@/client/lib/trpc";

/**
 * Routes som ska renderas utan sidebar (deras egen layout tar över).
 * Tomt just nu — /demo har egen path-detektion i DemoBootstrap.
 */
const FULLSCREEN_ROUTES: readonly string[] = [];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = trpc.user.current.useQuery(undefined, { staleTime: 60_000, retry: false });

  if (FULLSCREEN_ROUTES.includes(pathname ?? "")) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col h-full">
      <DemoModeBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar userName={current.data?.name ?? null} />
        <main className="flex-1 overflow-y-auto pt-16 lg:pt-0 p-4 sm:p-6 lg:p-8 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
