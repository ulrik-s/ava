/**
 * `resolveSelectedUsers` — pure beslut om vilka användares kalendrar som
 * ska visas vid mount.
 *
 * Prioritet:
 *   1. Deep-link (?date=) → ALLA org-users, så event av andra ägare än
 *      current-user syns (annars "tom kalender" trots att event finns).
 *   2. Sparat val i localStorage.
 *   3. Bara current-user (default).
 *   4. Tomt (inget laddat än).
 */

export interface SelectUsersInput {
  /** Tidigare val ur localStorage. */
  stored: string[];
  /** Inloggad användare. */
  currentUserId: string | null;
  /** Alla org-users (för deep-link-fallet). */
  orgUserIds: string[];
  /** True om URL:en har ?date= (deep-link från matter-detalj). */
  hasDateParam: boolean;
}

export function resolveSelectedUsers(input: SelectUsersInput): string[] {
  if (input.hasDateParam && input.orgUserIds.length > 0) {
    return [...input.orgUserIds];
  }
  if (input.stored.length > 0) return [...input.stored];
  if (input.currentUserId) return [input.currentUserId];
  return [];
}
