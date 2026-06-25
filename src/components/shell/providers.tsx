"use client";

/**
 * Providers — git-first app, alltid via DemoBootstrap.
 *
 * Tidigare hade vi en `FullProviders`-väg för server-läget med NextAuth +
 * httpBatchLink mot /api/trpc. Den är borta nu — det finns ingen
 * server-side att prata med. Allt går genom DemoDataStore + write-back
 * till git working copy.
 */

import { VatDisplayProvider } from "@/lib/client/vat/vat-display-context";
import { DemoBootstrap } from "./demo-bootstrap";
import { DiagnosticsRegistrar } from "./diagnostics-registrar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DemoBootstrap>
      <DiagnosticsRegistrar />
      <VatDisplayProvider>{children}</VatDisplayProvider>
    </DemoBootstrap>
  );
}
