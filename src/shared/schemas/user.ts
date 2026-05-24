import { z } from "zod";
import { baseFields, optionalDateLike } from "./common";
import { userRoleSchema } from "./enums";

/**
 * User — lagras i `.ava/users/<email>.json`. Auth-fält (passwordHash,
 * azureOid, lastLoginAt) lever bara i självhostade installationer.
 */

const publicKeySchema = z.object({
  fingerprint: z.string(),
  type: z.enum(["ssh-ed25519", "ssh-rsa", "ssh-ecdsa", "gpg"]),
  publicKey: z.string(),
  comment: z.string().optional(),
  addedAt: z.string(),
});

export const userSchema = z.object({
  ...baseFields,
  organizationId: z.string(),
  email: z.string(),
  name: z.string(),
  title: z.string().nullish(),
  role: userRoleSchema.default("LAWYER"),
  hourlyRate: z.number().int().nullish(),
  mileageRate: z.number().int().nullish(),
  active: z.boolean().default(true),
  /** bcrypt-hash. Frivilligt — fattas för demo-användare och Azure-only. */
  passwordHash: z.string().nullish(),
  azureOid: z.string().nullish(),
  lastLoginAt: optionalDateLike,
  publicKeys: z.array(publicKeySchema).default([]),
}).passthrough();

export type User = z.infer<typeof userSchema>;
export type PublicKey = z.infer<typeof publicKeySchema>;
