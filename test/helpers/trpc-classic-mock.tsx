/**
 * Den nya tRPC-bindningen i tester som ännu mockar den klassiska `trpc`
 * (ADR 0041, #1927).
 *
 * En sida som inte flyttats än testas med `vi.mock("@/lib/client/trpc", …)`,
 * men dess barn kan redan ha flyttats till `useTRPC()` (t.ex. `DataTable`).
 * Mocken ersätter hela modulen, så den måste också ge den nya bindningen:
 *
 *   vi.mock("@/lib/client/trpc", () => ({ ...NEW_TRPC_BINDING, trpc: { … } }));
 *
 * och renderingen sker med `renderWithNewTrpc`, som monterar samma bindnings
 * provider över `fakeTrpcLink`. När sidan själv flyttats går testet över till
 * `renderWithFakeTrpc` och mocken (och den här hjälparen) försvinner.
 */

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { ReactElement, ReactNode } from "react";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DATA_TABLE_HANDLERS } from "./trpc-both-fake";
import { fakeTrpcClient, fakeTrpcLink, type FakeTrpcLink, type TrpcHandlers } from "./trpc-fake";
import { seededQueryClient, type TrpcProxy } from "./trpc-seeded";

const context = createTRPCContext<AppRouter>();

/** Den nya bindningens exporter, att sprida in i en mock av `@/lib/client/trpc`. */
export const NEW_TRPC_BINDING = {
  TRPCProvider: context.TRPCProvider,
  useTRPC: context.useTRPC,
  useTRPCClient: context.useTRPCClient,
};

/** Det en rendering ger: renderingen och länkens anropslogg. */
export interface NewTrpcRender extends RenderResult {
  fake: FakeTrpcLink;
}

/** Svaren till de flyttade barnen, och det som redan ska finnas i cachen. */
export interface NewTrpcOptions extends Omit<RenderOptions, "wrapper"> {
  /** Utöver `DataTable`s svar (inga sparade val, ingen admin). */
  handlers?: TrpcHandlers;
  /** Frågor som ska ha svar redan vid första ritningen (som den gamla mocken gav). */
  seed?: (t: TrpcProxy, qc: QueryClient) => void;
}

/**
 * `render` där flyttade barn får svar ur `handlers`. Providern är en
 * `wrapper`, så `rerender` behåller den.
 */
export function renderWithNewTrpc(ui: ReactElement, options: NewTrpcOptions = {}): NewTrpcRender {
  const { handlers, seed, ...renderOptions } = options;
  const fake = fakeTrpcLink({ ...DATA_TABLE_HANDLERS, ...handlers });
  const queryClient = seededQueryClient(fake, seed ?? (() => {}));
  const trpcClient = fakeTrpcClient(fake.link);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <context.TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</context.TRPCProvider>
    </QueryClientProvider>
  );
  return { ...render(ui, { ...renderOptions, wrapper }), fake };
}
