"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import superjson from "superjson";

/**
 * Demo-build: ingen NextAuth-backend finns. SessionProvider:n triggar
 * automatiska /api/auth/session-anrop som faller tillbaka till
 * sign-in-redirect — vi måste utelämna den helt i statiska builden.
 */
const IS_DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 1000 },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  );

  const inner = (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );

  if (IS_DEMO_BUILD) {
    return inner;
  }

  return <SessionProvider>{inner}</SessionProvider>;
}
