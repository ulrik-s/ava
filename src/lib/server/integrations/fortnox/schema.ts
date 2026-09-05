/**
 * Fortnox-connector — zod-scheman (#82).
 *
 * Tunn, self-hosted connector som pushar verifikat (vouchers) till Fortnox
 * Voucher API. OAuth2 Authorization Code-flöde (det enda som stöds sedan
 * fasta access-tokens deprekerades 2025-04-30). Strikt parsning av all
 * extern data per [[feedback-zod-strict-parsing]].
 *
 * Allt här är ren config/data — inga hemligheter hårdkodas; client_id/secret
 * och tokens injiceras (env nu, secrets-valv #79 senare).
 */

import { z } from "zod";

import type { LedgerAccountMap } from "@/lib/shared/accounting/account-map";

// ─── OAuth ──────────────────────────────────────────────────────────────

/** Fortnox-endpoints. Bas-URL:er är overridebara för test/sandbox. */
export const FORTNOX_AUTH_BASE = "https://apps.fortnox.se";
export const FORTNOX_API_BASE = "https://api.fortnox.se";

export const fortnoxConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Måste exakt matcha redirect-URI:n registrerad i Developer Portal. */
  redirectUri: z.string().url(),
  /** Scopes (t.ex. "bookkeeping"). Voucher API ligger under "bookkeeping". */
  scopes: z.array(z.string().min(1)).min(1),
  /** Override för sandbox/test; default = produktions-endpoints. */
  authBase: z.string().url().default(FORTNOX_AUTH_BASE),
  apiBase: z.string().url().default(FORTNOX_API_BASE),
  /**
   * Fortnox `account_type` vid authorize (VALFRI; enda giltiga värdet =
   * "service"). Utelämnad = user-consent (token knyts till användaren) — det
   * flöde som verifierats mot sandbox. "service" = obevakat service-konto
   * (överlever att användaren slutar) men kräver att service-konto aktiverats
   * för appen i Developer Portal + att en sysadmin auktoriserar. Se README. (#213)
   */
  accountType: z.literal("service").optional(),
});
export type FortnoxConfig = z.infer<typeof fortnoxConfigSchema>;

/** Råsvar från `POST /oauth-v1/token` (snake_case från Fortnox). */
export const fortnoxTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string(),
  /** Sekunder till access-token går ut (Fortnox: 3600 = 1h). */
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
export type FortnoxTokenResponse = z.infer<typeof fortnoxTokenResponseSchema>;

/**
 * Persisterade tokens. Refresh-token ROTERAR vid varje refresh (gamla blir
 * ogiltig) → `refreshToken` MÅSTE skrivas tillbaka efter varje refresh.
 * `accessTokenExpiresAt` = epoch ms.
 */
export const fortnoxStoredTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});
export type FortnoxStoredTokens = z.infer<typeof fortnoxStoredTokensSchema>;

// ─── Konto-mappning (per byrå) ──────────────────────────────────────────

/**
 * Per-byrå kontoplan-mappning. VÄRDENA är ett bokföringsbeslut byrån gör —
 * connectorn levereras utan defaults (tomt = connectorn vägrar köra och ber
 * om konfiguration). BAS-kontona nedan är bara typ-dokumentation.
 *
 * Detta är connector-LOKAL form (bara kontonummer). Sanningskällan är byråns
 * org-inställning `ledgerAccountMap` (#249, redigeras i /settings); connectorn
 * deriverar denna delmängd via `fortnoxMappingFromLedgerMap` (#217). Roll→konto-
 * översättning är connector-specifik (ADR 0011) — därför lever den här, inte i
 * shared (som aldrig får bero på `integrations/*`).
 */
export const fortnoxKontoMappningSchema = z.object({
  /** Verifikatserie i Fortnox (t.ex. "A" eller en kundfaktura-serie). */
  voucherSeries: z.string().min(1),
  /** Kundfordran-konto (debet vid kundfaktura), t.ex. 1510. */
  kundfordran: z.string().min(1),
  /** Intäktskonto för advokatarvode (kredit), t.ex. 3041. */
  intaktArvode: z.string().min(1),
  /** Utgående moms 25 % (kredit), t.ex. 2611. */
  momsUtgaende: z.string().min(1),
  /** Utgående moms 12 % resp. 6 % (kredit) — vidarefakturerade utlägg (#790), valfria. */
  momsUtgaende12: z.string().min(1).optional(),
  momsUtgaende06: z.string().min(1).optional(),
  /** Intäktskonto för vidarefakturerade utlägg (kredit), valfritt. */
  intaktUtlagg: z.string().min(1).optional(),
});
export type FortnoxKontoMappning = z.infer<typeof fortnoxKontoMappningSchema>;

/**
 * Derivera Fortnox-konto-mappningen ur byråns `ledgerAccountMap` (#217/#249).
 * Plockar kontoNUMREN (Fortnox vill inte ha namnen) + verifikatserien.
 *
 * `null` när byrån inte konfigurerat någon mappning → connectorn vägrar köra
 * (completeness-gate). Är `ledgerAccountMap` satt är den per schema komplett
 * (alla obligatoriska roller finns), så ingen ytterligare lucka-koll behövs.
 */
export function fortnoxMappingFromLedgerMap(
  map: LedgerAccountMap | null | undefined,
): FortnoxKontoMappning | null {
  if (!map) return null;
  return fortnoxKontoMappningSchema.parse({
    voucherSeries: map.voucherSeries,
    kundfordran: map.kundfordran.number,
    intaktArvode: map.intaktArvode.number,
    momsUtgaende: map.momsUtgaende.number,
    ...(map.momsUtgaende12 ? { momsUtgaende12: map.momsUtgaende12.number } : {}),
    ...(map.momsUtgaende06 ? { momsUtgaende06: map.momsUtgaende06.number } : {}),
    ...(map.intaktUtlagg ? { intaktUtlagg: map.intaktUtlagg.number } : {}),
  });
}

// ─── Voucher (verifikat) ────────────────────────────────────────────────

/** En verifikatrad. Exakt EN av Debit/Credit > 0 per rad (resten 0). */
export const fortnoxVoucherRowSchema = z.object({
  Account: z.number().int(),
  Debit: z.number().nonnegative().default(0),
  Credit: z.number().nonnegative().default(0),
  TransactionInformation: z.string().optional(),
});
export type FortnoxVoucherRow = z.infer<typeof fortnoxVoucherRowSchema>;

/** Voucher-payload (det vi POST:ar). Belopp i KRONOR (Fortnox vill ha SEK). */
export const fortnoxVoucherSchema = z.object({
  VoucherSeries: z.string().min(1),
  TransactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  Description: z.string().min(1).max(200),
  Comments: z.string().optional(),
  VoucherRows: z.array(fortnoxVoucherRowSchema).min(2),
});
export type FortnoxVoucher = z.infer<typeof fortnoxVoucherSchema>;

/** Delsvar från `POST /3/vouchers` — det vi behöver för idempotens/spårning. */
export const fortnoxVoucherResponseSchema = z.object({
  Voucher: z.object({
    VoucherSeries: z.string(),
    VoucherNumber: z.number().int(),
    Year: z.number().int().optional(),
    TransactionDate: z.string().optional(),
  }),
});
export type FortnoxVoucherResponse = z.infer<typeof fortnoxVoucherResponseSchema>;

/**
 * Svar från `GET /3/vouchers/{serie}/{nr}` (#1030). Skilt från POST-svaret för
 * att det MÅSTE bära raderna: hela poängen med att läsa tillbaka är att kunna
 * kontrollera att verifikatet balanserar hos Fortnox, inte bara att skrivningen
 * gav 200. Löst (`looseObject`) — GET returnerar fler fält än vi bryr oss om,
 * och de ska inte fälla en läsning.
 */
export const fortnoxVoucherFetchSchema = z.object({
  Voucher: z.looseObject({
    VoucherSeries: z.string(),
    VoucherNumber: z.number().int(),
    VoucherRows: z.array(z.looseObject({
      Account: z.number().int(),
      Debit: z.number().default(0),
      Credit: z.number().default(0),
    })).min(1),
  }),
});
export type FortnoxVoucherFetch = z.infer<typeof fortnoxVoucherFetchSchema>;

// ─── Verifikatserier (#1035) ────────────────────────────────────────────────

/**
 * En verifikatserie ur `GET/POST /3/voucherseries`.
 *
 * `Manual` är fältet som avgör om serien duger för oss: en serie med
 * `Manual: false` (t.ex. `B` "Kundfakturor") är reserverad för Fortnox egna
 * automatposter och avvisar manuella verifikat. CI-serien måste vara manuell,
 * precis som `A` "Redovisning". Löst schema — Fortnox skickar fler fält.
 */
export const fortnoxVoucherSeriesSchema = z.looseObject({
  Code: z.string().min(1),
  Description: z.string().optional(),
  Manual: z.boolean().optional(),
  Year: z.number().int().optional(),
  NextVoucherNumber: z.number().int().optional(),
});
export type FortnoxVoucherSeries = z.infer<typeof fortnoxVoucherSeriesSchema>;

/** Svar från `GET /3/voucherseries` (lista). */
export const fortnoxVoucherSeriesListSchema = z.object({
  VoucherSeriesCollection: z.array(fortnoxVoucherSeriesSchema),
});

/** Svar från `POST/GET /3/voucherseries/{code}` (enskild serie). */
export const fortnoxVoucherSeriesResponseSchema = z.object({
  VoucherSeries: fortnoxVoucherSeriesSchema,
});

// ─── Verifikatlistning + räkenskapsår (#1050) ───────────────────────────────

/**
 * Ett verifikat som det ser ut i LISTsvaret. Rader ingår INTE — `GET /3/vouchers`
 * ger bara huvuden, raderna kräver `GET /3/vouchers/{serie}/{nr}` per verifikat
 * (verifierat mot skarp sandbox 2026-09-05). Det duger för delta-kollen, som
 * frågar VILKA verifikat som finns, inte vad de innehåller.
 */
export const fortnoxVoucherHeadSchema = z.looseObject({
  VoucherSeries: z.string().min(1),
  VoucherNumber: z.number().int(),
  Description: z.string().nullish(),
  TransactionDate: z.string().optional(),
  Year: z.number().int().optional(),
});
export type FortnoxVoucherHead = z.infer<typeof fortnoxVoucherHeadSchema>;

/** Fortnox pagineringshuvud. `@TotalPages` styr hur många sidor vi hämtar. */
export const fortnoxMetaSchema = z.looseObject({
  "@TotalResources": z.number().int().optional(),
  "@TotalPages": z.number().int().optional(),
  "@CurrentPage": z.number().int().optional(),
});

/** Svar från `GET /3/vouchers` (lista). */
export const fortnoxVoucherListSchema = z.object({
  MetaInformation: fortnoxMetaSchema.optional(),
  Vouchers: z.array(fortnoxVoucherHeadSchema),
});

/**
 * Ett räkenskapsår. `Id` är INTE årtalet — det är en löpande nyckel, och det är
 * den `financialyear`-parametern vill ha. Att hårdkoda den (CI-året råkade bli
 * `2`) hade gått sönder tyst dagen någon lägger upp ett år till, därför slås den
 * upp mot datumintervallet i stället.
 */
export const fortnoxFinancialYearSchema = z.looseObject({
  Id: z.number().int(),
  FromDate: z.string().min(1),
  ToDate: z.string().min(1),
});

/** Svar från `GET /3/financialyears` (lista). */
export const fortnoxFinancialYearListSchema = z.object({
  FinancialYears: z.array(fortnoxFinancialYearSchema),
});

// ─── Filbilaga (#785) ───────────────────────────────────────────────────────

/** Svar från `POST /3/inbox` (fil-uppladdning) — vi behöver fil-id:t (GUID). */
export const fortnoxInboxResponseSchema = z.object({
  File: z.object({ Id: z.string().min(1) }).passthrough(),
});
