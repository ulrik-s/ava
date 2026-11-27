"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { TRPCClient } from "@trpc/client";
import type { ReactNode } from "react";
import { trpc, TRPCProvider } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";

/** Det som båda tRPC-bindningarna delar: en klient och en QueryClient. */
export interface TrpcProvidersProps {
  trpcClient: TRPCClient<AppRouter>;
  queryClient: QueryClient;
  children: ReactNode;
}

/**
 * Båda React-bindningarna för tRPC under flytten (ADR 0041): den klassiska
 * `trpc.Provider` och den nya `TRPCProvider`, med samma klient och samma
 * QueryClient, så att en invalidering på ena sidan når den andra.
 */
export function TrpcProviders({ trpcClient, queryClient, children }: TrpcProvidersProps) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
