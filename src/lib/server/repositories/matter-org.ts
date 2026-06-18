/**
 * `matterOrg` (#528) — härled `organizationId` för en matter-scopad entitet som
 * saknar egen org-kolumn (document, documentFolder, …) via dess ärende. Används
 * av repo:ernas `resolveOrg`-override så change_log får rätt org → de delta-
 * synkas via pull (annars hoppades de över; bara org-kolumn-bärande rader
 * loggades).
 */

import { eq } from "drizzle-orm";
import { matters } from "../db/schema";
import type { AppDb } from "../db/types";

export async function matterOrg(db: AppDb, matterId: string | null | undefined): Promise<string | undefined> {
  if (!matterId) return undefined;
  const [m] = await db
    .select({ org: matters.organizationId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  return m?.org ?? undefined;
}
