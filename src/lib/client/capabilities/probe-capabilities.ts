/**
 * `probeCapabilities` (ADR 0027) — klientens server-probe: kalla den DEPLOYADE
 * serverns `system.capabilities` (HTTP) för att lära sig vad servern kan. Når
 * ingen server (demon, eller server nere) → `null` inom en kort timeout, och
 * anroparen faller tillbaka på demo-baslinjen. Aldrig kastar — probe får aldrig
 * blockera bootstrappen (jfr "AVA Laddar…", #628).
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { serverTrpcEndpoint } from "@/lib/client/backend/http-backend-runtime";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { Capabilities } from "@/lib/shared/capabilities";

const PROBE_TIMEOUT_MS = 4000;

export async function probeCapabilities(baseUrl?: string): Promise<Capabilities | null> {
  try {
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: serverTrpcEndpoint(baseUrl), transformer: superjson })],
    });
    const query = client.system.capabilities.query().catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS));
    return (await Promise.race([query, timeout])) as Capabilities | null;
  } catch {
    return null;
  }
}
