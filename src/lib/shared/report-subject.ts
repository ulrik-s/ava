/**
 * Vem en rapport gäller (#2113): en jurist eller hela byrån. Ramverksfri, så
 * att både servern (hämtningen) och klienten (valet i rapporten) kan läsa den.
 */
import type { UserId } from "@/lib/shared/schemas/ids";

/** Rapportens subjekt: en jurists arbete, eller hela byråns. */
export type ReportSubject = { kind: "lawyer"; userId: UserId } | { kind: "firm" };
