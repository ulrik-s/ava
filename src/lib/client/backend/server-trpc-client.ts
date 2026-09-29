"use client";

/**
 * tRPC-klient mot den DEPLOYADE servern (`/api/trpc`, samma origin, cookie via
 * oauth2-proxy). I self-hosted körs routrarna annars i webbläsaren mot den
 * lokala storen; det som bara servern kan (Fortnox-bokföring #1172,
 * fulltextsökning #1215, dokument-bytes #651, serverns helper-config #1161)
 * anropas direkt härigenom.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { HelperConfigRequest } from "@/lib/shared/helper/protocol";
import { serverTrpcEndpoint } from "./http-backend-runtime";

/** Klient mot serverns tRPC-endpoint (`baseUrl` default: samma origin). */
export function serverTrpcClient(baseUrl?: string) {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: serverTrpcEndpoint(baseUrl), transformer: superjson })] });
}

/**
 * Serverns inloggnings-config för AVA Helper (#1161). Måste läsas AV SERVERN:
 * via in-process-klienten körs `system.helperConfig` i webbläsaren, där
 * serverns env saknas — svaret blev alltid null och helpern konfigurerades aldrig.
 */
export function loadServerHelperConfig(): Promise<HelperConfigRequest | null> {
  return serverTrpcClient().system.helperConfig.query();
}
