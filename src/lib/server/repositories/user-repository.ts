/**
 * `UserRepository` (ADR 0020, #409 fan-out) — användare. Bas-CRUD ärvs;
 * org-scopas direkt på `organizationId`. Repot returnerar HELA raden
 * (inkl. passwordHash) — projektionen (vilka fält som exponeras)
 * bor kvar i routern, så känsliga fält inte läcker av misstag.
 */

import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { User } from "@/lib/shared/schemas/user";
import type { Repository } from "./types";

export interface UserRepository extends Repository<User> {
  /** Användare by id, org-scopad (null om saknas/annan org/raderad). */
  getByIdInOrg(id: UserId, organizationId: OrganizationId): Promise<User | null>;
  /** Alla (icke-raderade) användare i org:en, namn-sorterade. */
  listByOrg(organizationId: OrganizationId): Promise<User[]>;
  /**
   * Användarna (i ALLA byråer, icke-raderade) vars e-post är samma inloggning
   * som `email` — skiftläge och omgivande blanksteg spelar ingen roll (#1408).
   * Adressen är unik, så fler än en träff är en dubblett från före indexet.
   */
  listByLoginEmail(email: string): Promise<User[]>;
}
