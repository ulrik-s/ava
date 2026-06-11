# Fortnox-connector (#82)

Tunn, **self-hosted** connector som pushar AVA:s kundfakturor till Fortnox som
verifikat (vouchers) via Voucher API. Körs i server-runtime:n (ADR 0005), aldrig
i browsern — `client_secret` och tokens får aldrig nå klienten.

## Vad som är byggt (denna PR)

| Fil | Ansvar |
|---|---|
| `schema.ts` | Zod-scheman: config, OAuth-token-svar, persisterade tokens, konto-mappning, voucher-payload/-svar |
| `oauth.ts` | OAuth2 Authorization Code-flöde: `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshTokens` |
| `token-store.ts` | `FortnoxTokenStore`-interface + in-memory-impl (riktig backend = #79) |
| `client.ts` | `FortnoxClient`: håller access-token färsk (refresh + rotation), 401-retry, `createVoucher` |
| `voucher.ts` | `buildVoucherFromInvoice`: faktura → balanserat verifikat (debet kundfordran, kredit intäkt + moms) |

Allt är enhetstestat utan riktig Fortnox (injicerad `fetch`).

## Vad som återstår (kräver dig / uppföljning)

1. **Fortnox-credentials** — registrera en integration i [Developer Portal](https://www.fortnox.se/developer/developer-portal):
   - scope **`bookkeeping`** (Voucher API), en **redirect-URI** som pekar på server-connectorn.
   - Du får `client_id` + `client_secret`. **Lägg dem i secrets-valvet (#79), inte i git.**
   - Skapa ett **sandbox** att validera mot innan skarp drift.
2. **Konto-mappning** — `FortnoxKontoMappning` (verifikatserie + konton för kundfordran/arvode/moms) är ett **bokföringsbeslut per byrå**. Connectorn levereras utan defaults.
3. **Server-wiring** — koppla in `FortnoxClient.createVoucher` som en `PeerAct`-connector i `server-runtime` (pull av icke-synkade fakturor → bygg verifikat → push → skriv tillbaka `invoice.fortnoxId` för idempotens). Görs när creds finns.
4. **Bekräfta mot sandbox**: exakt voucher-wire-nesting (`VoucherRows: { VoucherRow: [...] }` per dok) och authorize-parametrarna (`access_type=offline`, `account_type=service`). Isolerat i `toWireVoucher` / `buildAuthorizeUrl` → trivialt att justera.
5. **Uppföljning**: fler-VAT-/vidarefakturerade-utlägg-uppdelning (kräver fakturarader, inte bara totalen).

## OAuth-flöde (kortfattat)

```
buildAuthorizeUrl(config, state)  → användaren godkänner i Fortnox
   → redirect ?code=…&state=…
exchangeCodeForTokens(config, code) → { accessToken, refreshToken, expiresAt }  → spara i store
FortnoxClient.createVoucher(v)    → använder/refreshar token automatiskt
```

Refresh-token **roterar** (gammal blir ogiltig) — `client.ts` sparar alltid den
nya via `FortnoxTokenStore.save`. Access-token: 1 h, refresh-token: 45 dygn.
