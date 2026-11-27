import { createTRPCReact } from "@trpc/react-query";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@/lib/server/routers/_app";

/**
 * Den klassiska React-bindningen (`trpc.x.y.useQuery(…)`). Utfasad: ny kod
 * använder `useTRPC()` nedan. Filerna flyttas en i taget, och spärrtestet
 * `test/unit/lib/client/classic-trpc-allowlist.test.ts` listar de som får
 * använda den (ADR 0041).
 */
export const trpc = createTRPCReact<AppRouter>();

const context = createTRPCContext<AppRouter>();

/**
 * Providern för den nya bindningen. Får samma `trpcClient` och `queryClient`
 * som `trpc.Provider`, så att cachen och invalideringarna delas (ADR 0041).
 */
export const TRPCProvider = context.TRPCProvider;

/**
 * Options-proxyn för TanStack Querys egna hooks:
 * `useQuery(trpc.x.y.queryOptions(input))`, `useMutation(trpc.x.y.mutationOptions())`
 * och `queryClient.invalidateQueries(trpc.x.y.queryFilter())` (ADR 0041).
 */
export const useTRPC = context.useTRPC;

/** Den råa tRPC-klienten (`client.x.y.query(input)`) ur `TRPCProvider`. */
export const useTRPCClient = context.useTRPCClient;
