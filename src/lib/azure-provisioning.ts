/**
 * Invite-baserad provisionering för Entra ID (O365) inloggning.
 *
 * Flöde:
 *   1. Admin skapar User-post i AVA i förväg (via /users/new) — utan passwordHash.
 *   2. När användaren loggar in via Microsoft första gången:
 *      a. Verifiera att token kommer från rätt tenant (single-tenant).
 *      b. Matcha på e-post. Finns ingen User → avvisa (ingen auto-provision).
 *      c. Fyll i azureOid på matchande User så nästa login matchar på oid.
 *   3. Efterföljande logins: matcha primärt på azureOid, fallback till email.
 */
import type { PrismaClient } from "@prisma/client";

export interface AzureProfile {
  /** Entra ID object-id. Stabilt, byter aldrig. */
  oid: string;
  /** Tenant-id token kom ifrån. Måste matcha org.azureTenantId. */
  tid: string;
  /** User Principal Name / email. */
  email: string;
  /** Visningsnamn. */
  name: string;
}

export type ResolveResult =
  | { ok: true; userId: string; organizationId: string; role: string }
  | { ok: false; reason: "WRONG_TENANT" | "NOT_INVITED" | "MISSING_EMAIL" };

/**
 * Given an Entra ID profile, look up the corresponding AVA user and verify
 * tenant binding. Returns a discriminated union — callers should translate
 * "ok: false" results into a user-facing error page.
 *
 * Does not write anything if resolution fails. On first successful match by
 * email, stamps azureOid + lastLoginAt so future logins use the stable oid.
 */
export async function resolveAzureUser(
  prisma: Pick<PrismaClient, "user" | "organization">,
  profile: AzureProfile,
): Promise<ResolveResult> {
  if (!profile.email) {
    return { ok: false, reason: "MISSING_EMAIL" };
  }

  // 1. Must match a known tenant (single-tenant per Organization).
  const org = await prisma.organization.findUnique({
    where: { azureTenantId: profile.tid },
    select: { id: true },
  });
  if (!org) {
    return { ok: false, reason: "WRONG_TENANT" };
  }

  // 2. Primary lookup: stable Azure oid (set on prior logins).
  let user = await prisma.user.findUnique({
    where: { azureOid: profile.oid },
    select: { id: true, organizationId: true, role: true, email: true },
  });

  if (user) {
    if (user.organizationId !== org.id) {
      // Safety: oid matched but binds to a different org than the token tenant.
      // Treat as not invited in the tenant that's trying to log in.
      return { ok: false, reason: "NOT_INVITED" };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return { ok: true, userId: user.id, organizationId: user.organizationId, role: user.role };
  }

  // 3. Fallback: first-time linking by email (case-insensitive).
  const emailLower = profile.email.toLowerCase();
  const byEmail = await prisma.user.findFirst({
    where: {
      email: { equals: emailLower, mode: "insensitive" },
      organizationId: org.id,
    },
    select: { id: true, organizationId: true, role: true, azureOid: true },
  });

  if (!byEmail) {
    // Admin har inte bjudit in användaren — ingen auto-provision.
    return { ok: false, reason: "NOT_INVITED" };
  }

  if (byEmail.azureOid && byEmail.azureOid !== profile.oid) {
    // E-post matchar men oid är redan knuten till en annan identitet.
    // Detta bör inte hända i praktiken men vi blockerar säkerhetsmässigt.
    return { ok: false, reason: "NOT_INVITED" };
  }

  await prisma.user.update({
    where: { id: byEmail.id },
    data: { azureOid: profile.oid, lastLoginAt: new Date() },
  });

  return { ok: true, userId: byEmail.id, organizationId: byEmail.organizationId, role: byEmail.role };
}
