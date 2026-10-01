/**
 * Servern svarade 401 vid synk (#1245, #1351, ADR 0018). Serverns skäl
 * (`data.authFailure`) avgör när det finns; annars frågas proxyn:
 *
 *   - Kontot är inte aktivt (servern vet) → besked om karantän: ändringarna
 *     hålls kvar på enheten — aldrig tyst borttagna — men sparas inte.
 *   - Proxyn har en session för någon ANNAN än den bundna (#1404) — någon
 *     loggade in i en annan flik och proxyns cookie byttes → ladda om.
 *     Sessionsgrinden binder då den nya användaren och rensar den förras
 *     lokala data, precis som vid ett identitetsbyte vid start (#1347). Den
 *     förras osynkade ändringar ligger kvar i hennes egna databaser.
 *   - Token har gått ut (servern vet), eller proxyn har en session (för den
 *     bundna) som servern ändå inte godtar → "Logga in igen".
 *   - Proxyn har ingen session → "Logga in igen".
 *   - Proxyn nås inte → inget särskilt besked; nästa synk försöker igen.
 *
 * Ingen hård omdirigering (#1351): ett formulär mitt i skrivandet ska inte
 * försvinna, och IdP:n kan vara nere. Bannern låter användaren välja när.
 * Kön ligger kvar i IndexedDB och synkas efter inloggningen.
 */

import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";
import type { AuthFailure } from "@/lib/shared/auth-failure";
import { sameIdentity } from "./session-gate";
import type { SessionNotice } from "./session-notice";
import type { SessionProbe } from "./session-probe";

export interface RevalidateDeps {
  probe: () => Promise<SessionProbe>;
  /** Visa "Logga in igen"-bannern. */
  notify: (notice: SessionNotice) => void;
  /** E-posten för den bundna användaren (firma-config), eller null om ingen är bunden (#1404). */
  boundEmail: string | null;
  /** Ladda om sidan — sessionsgrinden tar över (#1404). */
  reload: () => void;
}

export const SESSION_EXPIRED_MESSAGE = "Inloggningen har gått ut — klicka på Logga in igen. Osynkade ändringar finns kvar.";
export const TOKEN_EXPIRED_MESSAGE = "Servern godtar inte längre inloggningen (token har gått ut) — klicka på Logga in igen. Osynkade ändringar finns kvar.";
export const ACCOUNT_REVOKED_MESSAGE =
  "Ditt konto är inte längre aktivt i byrån. Osynkade ändringar finns kvar på enheten men sparas inte på servern förrän en administratör återaktiverar kontot.";

export const IDENTITY_SWITCH_MESSAGE =
  "En annan användare har loggat in i webbläsaren — sidan laddas om. Dina osynkade ändringar finns kvar till nästa gång du loggar in.";

const MESSAGES: Record<Exclude<SessionNotice, "unreachable">, string> = {
  "signed-out": SESSION_EXPIRED_MESSAGE,
  "token-expired": TOKEN_EXPIRED_MESSAGE,
};

function reauth(deps: RevalidateDeps, notice: Exclude<SessionNotice, "unreachable">): string {
  deps.notify(notice);
  return MESSAGES[notice];
}

/** Proxyn släpper igenom men servern vägrar: en annan identitet → ladda om; annars duger inte token. */
function authenticatedButRefused(deps: RevalidateDeps, claims: OidcClaims): string {
  if (deps.boundEmail !== null && !sameIdentity(deps.boundEmail, claims)) {
    deps.reload();
    return IDENTITY_SWITCH_MESSAGE;
  }
  return reauth(deps, "token-expired");
}

/** Beskedet att visa (null = inget särskilt). `failure` = serverns skäl, om det kom med. */
export async function revalidateSession(deps: RevalidateDeps, failure: AuthFailure | null): Promise<string | null> {
  if (failure === "account-inactive") return ACCOUNT_REVOKED_MESSAGE;
  if (failure === "token-expired") return reauth(deps, "token-expired");
  const probe = await deps.probe();
  if (probe.kind === "signed-out") return reauth(deps, "signed-out");
  return probe.kind === "authenticated" ? authenticatedButRefused(deps, probe.claims) : null;
}
