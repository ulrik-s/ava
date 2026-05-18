/**
 * `ClaimsProjection` — claim-rader hamnar i `claims/<år>/<mm>/<dd>.jsonl`.
 *
 * Format som spiken validerade (se `spikes/claim-race/`):
 *   { claimId, claimedBy, at, expiresAt }
 *
 * Korrekthetstest visade att även med 15 konkurrerande klienter blir
 * filen aldrig korrupt — git's CAS på ref-nivå hanterar konkurrensen.
 */

import { z } from "zod";
import { JsonLinesProjection } from "./base";
import { dayBucketPath } from "./time-bucket";

export const claimRowSchema = z.object({
  claimId: z.string().min(1),
  claimedBy: z.string().min(1),
  at: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type ClaimRow = z.infer<typeof claimRowSchema>;

export class ClaimsProjection extends JsonLinesProjection<ClaimRow> {
  constructor() { super(claimRowSchema); }

  pathFor(row: ClaimRow): string {
    return dayBucketPath("claims", new Date(row.at));
  }
}
