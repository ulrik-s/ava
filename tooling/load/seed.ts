/**
 * Byråerna och juristerna lasttestet kör som (#1366).
 *
 * Användarna skapas via de RIKTIGA Drizzle-repona med change_log påslagen —
 * samma som synksimuleringen (#1268) — så att klienterna pullar sina kollegor
 * och routrarna i klienten hittar användaren (`requireUserInOrg`). Idempotent:
 * en befintlig rad lämnas orörd, så skriptet kan köras om mot en stack som står kvar.
 */

import { createPostgresDb } from "@/lib/server/db/client";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { asId } from "@/lib/shared/schemas/ids";
import type { LoadConfig, OrgTarget } from "./config";
import type { LoadUser } from "./virtual-user";

/** Fast id per användare (1-baserat), så att omkörningar träffar samma rader. */
export function userId(index: number): string {
  return `00000000-0000-7000-8000-${String(1366_100_000 + index).padStart(12, "0")}`;
}

/** Användarna, jämnt fördelade över byråerna (användare i hamnar i byrå i mod antal). */
export function buildUsers(config: Pick<LoadConfig, "users" | "orgs">): LoadUser[] {
  return Array.from({ length: config.users }, (_, i) => {
    const org = config.orgs[i % config.orgs.length];
    if (!org) throw new Error("minst en byrå krävs");
    return { id: userId(i + 1), email: `jurist${i + 1}@byra${org.index}.lasttest.se`, name: `Jurist ${i + 1}`, org };
  });
}

/** Skapa byrån och dess jurister (om de saknas). */
async function seedOrg(org: OrgTarget, users: readonly LoadUser[]): Promise<void> {
  const { db, close } = createPostgresDb(org.databaseUrl, { max: 2 });
  try {
    const repos = buildDrizzleRepositories(db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(db));
    const organizationId = asId<"OrganizationId">(org.organizationId);
    if (!(await repos.organizations.getById(organizationId))) {
      await repos.organizations.create({ id: organizationId, name: `Lasttestbyrån ${org.index}` });
    }
    for (const u of users) {
      if (await repos.users.getById(asId<"UserId">(u.id))) continue;
      await repos.users.create({ id: asId<"UserId">(u.id), organizationId, email: u.email, name: u.name, role: "LAWYER", active: true });
    }
  } finally {
    await close();
  }
}

/** Seeda alla byråer. */
export async function seedAll(orgs: readonly OrgTarget[], users: readonly LoadUser[]): Promise<void> {
  for (const org of orgs) await seedOrg(org, users.filter((u) => u.org.index === org.index));
}
