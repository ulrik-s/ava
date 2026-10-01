/**
 * Byråavgränsade uppslag (#1345) — ett id i input ska peka på en rad i
 * anroparens byrå. Servern kör om köade anrop (ADR 0037) som den som skickade
 * dem, och ett ärende- eller användar-id ur en annan byrå ska inte gå att
 * skriva mot. NOT_FOUND vid mismatch: existensen i en annan byrå läcker inte.
 */

import type { MatterId, OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { User } from "@/lib/shared/schemas/user";
import type { Repositories } from "../repositories/repositories";
import { TRPCError } from "../trpc-core";

/** Det uppslagen behöver ur en tRPC-context. */
export interface OrgScope {
  readonly repos: Pick<Repositories, "matters" | "users">;
  readonly orgId: OrganizationId;
}

/** Ärendet, om det finns i byrån — annars NOT_FOUND. */
export async function requireMatterInOrg(ctx: OrgScope, matterId: MatterId): Promise<Matter> {
  const matter = await ctx.repos.matters.getByIdInOrg(matterId, ctx.orgId);
  if (!matter) throw new TRPCError({ code: "NOT_FOUND", message: "Ärendet finns inte." });
  return matter;
}

/** Användaren, om hen finns i byrån — annars NOT_FOUND. */
export async function requireUserInOrg(ctx: OrgScope, userId: UserId): Promise<User> {
  const user = await ctx.repos.users.getByIdInOrg(userId, ctx.orgId);
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Användare finns inte." });
  return user;
}
