/**
 * `UserProjection` — projicierar en användare till `.ava/users/<email>.json`.
 *
 * Filplaceringen i `.ava/users/` är medvetet vald så att en
 * `post-receive`-hook på SSH-servern kan plocka SSH-nycklar härifrån
 * och regenerera `authorized_keys` automatiskt (se architecture-future.md §3.8).
 *
 * Email används som filnamn istället för id-cuid, eftersom det är
 * mänskligt läsbart och stabilt över tid.
 */

import { z } from "zod";
import { JsonProjection } from "./base";

export const userProjectionSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.string(),
  hourlyRate: z.number().int().nullable().optional(),
  /** SSH-public-keys för git-server-auth. Tom array = ingen auth ännu. */
  sshPublicKeys: z.array(z.string()).default([]),
  organizationId: z.string(),
  /** OIDC-bindning (#223, ADR 0009) — bevaras vid hydrering om satt. */
  oidcSubject: z.string().nullable().optional(),
  oidcIssuer: z.string().nullable().optional(),
});

export type UserProjectionData = z.infer<typeof userProjectionSchema>;

export class UserProjection extends JsonProjection<UserProjectionData> {
  constructor() { super(userProjectionSchema); }

  pathFor(u: UserProjectionData): string {
    // Slugifiera email — undvik specialtecken som krånglar i filsystem.
    const safe = u.email.toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
    return `.ava/users/${safe}.json`;
  }
}
