/**
 * Vem äger de gemensamma lokala databaserna från före #1347?
 *
 * Före #1347 hade databaserna samma namn för alla användare. Det som ligger i
 * dem tillhör den användare som var bunden i webbläsaren när den nya koden
 * kördes första gången: hennes `principalId` — eller, om hon loggat ut med
 * gammal kod (som bara tog bort `principalId`), hennes e-postadress. Ägaren
 * avgörs EN gång och sparas, så att en senare inloggad användare aldrig kan
 * ta över dem. Går ägaren inte att avgöra tar ingen över dem.
 */

import { z } from "zod";
import { PLACEHOLDER_AUTHOR_EMAILS, type FirmaConfig } from "@/lib/client/firma/firma-config";
import type { LocalScope } from "./local-namespace";

/** localStorage-nyckeln där ägaren sparas. */
export const LEGACY_OWNER_KEY = "ava.localData.legacyOwner";

const legacyOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    organizationId: z.string(),
    principalId: z.string().exactOptional(),
    email: z.string().exactOptional(),
  }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);

/** Ägaren av de gemensamma databaserna, eller `none` om den inte går att avgöra. */
export type LegacyOwner = z.infer<typeof legacyOwnerSchema>;

/** Den del av `localStorage` som används (injicerbar i tester). */
export type OwnerStorage = Pick<Storage, "getItem" | "setItem">;

/** En e-postadress som pekar ut en person (inte default-configens platshållare). */
function personalEmail(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  return normalized && !PLACEHOLDER_AUTHOR_EMAILS.has(normalized) ? normalized : undefined;
}

/** Ägaren enligt configen som gäller nu. */
export function ownerFromConfig(cfg: Pick<FirmaConfig, "organizationId" | "principalId" | "authorEmail">): LegacyOwner {
  const email = personalEmail(cfg.authorEmail);
  if (!cfg.principalId && !email) return { kind: "none" };
  return {
    kind: "user",
    organizationId: cfg.organizationId,
    ...(cfg.principalId ? { principalId: cfg.principalId } : {}),
    ...(email ? { email } : {}),
  };
}

function storedOwner(storage: OwnerStorage): LegacyOwner | null {
  try {
    const raw = storage.getItem(LEGACY_OWNER_KEY);
    if (raw === null) return null;
    const parsed = legacyOwnerSchema.safeParse(JSON.parse(raw));
    // Trasig post → ingen ägare (aldrig en gissning som kan ge fel användare datan).
    return parsed.success ? parsed.data : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** Ägaren — första gången härledd ur `cfg` och sparad; därefter alltid den sparade. */
export function legacyOwner(cfg: Pick<FirmaConfig, "organizationId" | "principalId" | "authorEmail">, storage: OwnerStorage): LegacyOwner {
  const stored = storedOwner(storage);
  if (stored) return stored;
  const owner = ownerFromConfig(cfg);
  storage.setItem(LEGACY_OWNER_KEY, JSON.stringify(owner));
  return owner;
}

/** Äger användaren (`scope`, inloggad med `email`) de gemensamma databaserna? */
export function ownsLegacyData(owner: LegacyOwner, scope: LocalScope, email: string): boolean {
  if (owner.kind === "none" || owner.organizationId !== scope.organizationId) return false;
  if (owner.principalId !== undefined) return owner.principalId === scope.principalId;
  return owner.email !== undefined && owner.email === personalEmail(email);
}
