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

/** Värdet för **Alla** (hela byrån) i fältet Advokat (#2116). */
export const FIRM_CHOICE = "ALLA";

/** Ett värde i fältet Advokat: en användares id, eller {@link FIRM_CHOICE}. */
export type SubjectValue = UserId | typeof FIRM_CHOICE;

/** Ett alternativ i fältet Advokat. */
export interface SubjectChoice { value: SubjectValue; label: string }

/**
 * Alternativen i Rapporters fält Advokat (#2116). Den som inte ser allas
 * tider får ett enda alternativ, sig själv; en Admin får **Alla** överst och
 * sedan alla användare.
 */
export function subjectChoices(
  users: readonly { id: UserId; name: string }[], selfId: UserId, seesAll: boolean,
): SubjectChoice[] {
  if (!seesAll) return [{ value: selfId, label: users.find((u) => u.id === selfId)?.name ?? "" }];
  return [{ value: FIRM_CHOICE, label: "Alla" }, ...users.map((u) => ({ value: u.id, label: u.name }))];
}

/**
 * Vem rapporten gäller (#2116). Den som inte ser allas tider får alltid sig
 * själv, oavsett `explicit`. En Admin får sitt val, och utan val sig själv.
 */
export function resolveSubject(explicit: SubjectValue | null, selfId: UserId, seesAll: boolean): ReportSubject {
  if (!seesAll || explicit === null) return { kind: "lawyer", userId: selfId };
  return explicit === FIRM_CHOICE ? { kind: "firm" } : { kind: "lawyer", userId: explicit };
}

/** Fältets värde för `subject`. */
export function subjectValue(subject: ReportSubject): SubjectValue {
  return subject.kind === "firm" ? FIRM_CHOICE : subject.userId;
}
