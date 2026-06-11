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
  /** Intäktskonto för vidarefakturerade utlägg (kredit), valfritt. */
  intaktUtlagg: z.string().min(1).optional(),
});
export type FortnoxKontoMappning = z.infer<typeof fortnoxKontoMappningSchema>;

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
