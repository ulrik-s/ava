# ADR 0041 — Webbappens React-bindning för tRPC: `@trpc/tanstack-react-query`

**Status:** Antagen · **Datum:** 2026-11-25 · **Issue:** #1926 · **Intag:** ava-feedback#54
**Bygger på:** [ADR 0016](0016-server-first-med-offline-first-klient.md), [ADR 0031](0031-helpern-som-tunn-trpc-klient.md), [ADR 0035](0035-ava-cli-och-mcp-over-approuter.md)

## Kontext

Webbappens React-klient för tRPC är `createTRPCReact` ur `@trpc/react-query`
(`src/lib/client/trpc.ts`). Den är utfasad sedan tRPC 11.25: paketet får bara
buggfixar och tas bort i nästa major. Webbappen har cirka 285 anrop i 94 filer.
Ingen ADR beskriver React-bindningen; ADR 0016 och 0031 säger bara att tRPC är
gränsen.

## Beslut

Webbappen använder `@trpc/tanstack-react-query` i kontext-varianten
(`TRPCProvider`, `useTRPC`, `useTRPCClient`) med TanStack Querys egna hooks:

- `useQuery(trpc.x.queryOptions(…))`,
- `useMutation(trpc.x.mutationOptions(…))`,
- `useQueryClient()` med `queryFilter`/`pathFilter` för invalidering.

Paketet följer samma version som `@trpc/client` och `@trpc/server` (peer-kravet
är exakt samma version).

Under flytten finns båda bindningarna, med samma klient och samma QueryClient
(`src/components/shell/trpc-providers.tsx`), så att en invalidering på ena sidan
når den andra. Spärrtestet `test/unit/lib/client/classic-trpc-allowlist.test.ts`
låter bara de gamla filerna importera den klassiska `trpc`, och listan får bara
krympa. Ny kod skrivs på det nya sättet. Komponenttester använder
`test/helpers/trpc-fake.tsx` (`fakeTrpcLink`, `TrpcTestProvider`).

Kontext-varianten, inte `createTRPCOptionsProxy`: tRPC-klienten byggs först när
storen har öppnats, och demon och self-hosted bygger olika klienter.

## Alternativ

- **(a) Stanna på `@trpc/react-query` till nästa major:** inget arbete nu, men
  allt flyttas på en gång under tidspress, och ny kod ökar skulden.
- **(b) `createTRPCOptionsProxy` som modulsingel:** enklare import, men klienten
  byggs först när storen har öppnats och skiljer mellan demo och self-hosted.
- **(c) Egna hooks ovanpå `@trpc/client`:** ett eget litet ramverk.

## Konsekvenser

- \+ tRPC:s rekommenderade väg och TanStack Querys vanliga API, och undantaget
  för `no-deprecated` försvinner när flytten är klar.
- \+ Cachen och invalideringarna blir vanliga TanStack-filter, och
  komponenttesterna går mot en riktig QueryClient.
- − Ett nytt beroende som måste följa `@trpc/*`-versionen exakt (peer).
- − Fem PR:er med mekaniska ändringar som väntar in pågående ordrar i samma filer.
