/**
 * Vem en rapport gäller (#2113): en jurist eller hela byrån. Ramverksfri, så
 * att både servern (hämtningen) och klienten (valet i rapporten) kan läsa den.
 */
import type { UserRole } from "@/lib/shared/schemas/enums";
import type { UserId } from "@/lib/shared/schemas/ids";

/** Rapportens subjekt: en jurists arbete, eller hela byråns. */
export type ReportSubject = { kind: "lawyer"; userId: UserId } | { kind: "firm" };

/**
 * Om rollen ser allas tidsposter på Tidregistrering (#2114): bara Admin.
 * Övriga ser sina egna. Regeln gäller vyn, inte synken eller behörigheterna,
 * och ärendets flik Tid visar fortfarande ärendets all tid.
 */
export function seesAllTime(role: UserRole): boolean {
  return role === "ADMIN";
}
