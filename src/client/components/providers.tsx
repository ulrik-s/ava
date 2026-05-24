"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/client/lib/trpc";
import { DemoBootstrap } from "./demo-bootstrap";
import superjson from "superjson";

const IS_DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

export function Providers({ children }: { children: React.ReactNode }) {
  if (IS_DEMO_BUILD) {
    return <DemoBootstrap>{children}</DemoBootstrap>;
  }
  return <FullProviders>{children}</FullProviders>;
}

function FullProviders({ children }: { children: React.ReactNode }) {
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

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
}
