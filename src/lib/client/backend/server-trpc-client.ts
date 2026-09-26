"use client";

/**
 * tRPC-klient mot den DEPLOYADE servern (`/api/trpc`, samma origin, cookie via
 * oauth2-proxy). I self-hosted körs routrarna annars i webbläsaren mot den
 * lokala storen; det som bara servern kan (Fortnox-bokföring #1172,
 * fulltextsökning #1215) anropas direkt härigenom.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { serverTrpcEndpoint } from "./http-backend-runtime";

export function serverTrpcClient() {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: serverTrpcEndpoint(), transformer: superjson })] });
}
