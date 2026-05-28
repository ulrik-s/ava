/**
 * Column/list-preferences — sparas per user och valfritt globalt per org
 * (admin satta defaults). Merge-logik: personal > org > komponent-default.
 *
 * `prefs` är medvetet permissivt (z.record) — DataTable-komponenten avgör
 * vilken form den behöver (sortBy, sortDir, columns[]). Det håller schemat
 * stabilt över tid när vi lägger till nya pref-typer (filter, density…).
 */

import { z } from "zod";

const prefsPayloadSchema = z.record(z.string(), z.unknown());

export const userPreferenceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string().optional(),
  /** Stabil nyckel: "list.contacts", "list.matters", … (1 per UI-vy). */
  key: z.string(),
  prefs: prefsPayloadSchema,
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
}).passthrough();

export type UserPreference = z.infer<typeof userPreferenceSchema>;

export const orgPreferenceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  prefs: prefsPayloadSchema,
  /** Admin som satte default:en (audit-spår). */
  createdById: z.string().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
}).passthrough();

export type OrgPreference = z.infer<typeof orgPreferenceSchema>;
