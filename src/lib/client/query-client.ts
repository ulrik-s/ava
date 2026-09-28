/**
 * `makeAppQueryClient` — appens QueryClient, för alla tiers.
 *
 * `networkMode: "always"` (#1241): procedurerna körs i klienten mot den lokala
 * storen (ADR 0016), så frågor och mutationer behöver inte nätet. TanStacks
 * standard (`"online"`) pausar allt när webbläsaren går offline — en ändring
 * gjord under ett avbrott hängde då på "Sparar…" och nådde aldrig den lokala
 * kön. Det som faktiskt kräver servern (online-only-handlingar, ADR 0021)
 * misslyckas i stället synligt och kan göras om.
 */

import { QueryClient } from "@tanstack/react-query";

export function makeAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: false, networkMode: "always" },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}
