/**
 * Seed-script: lägger in `STARTER_RULES` i `ava_rules`-tabellen för en byrå.
 *
 * Kör:
 *   yarn tsx scripts/seed-rules.ts --org <orgId>
 *
 * Reglerna är `enabled: false` per default — aktivera dem via UI eller
 * direkt i DB:n.
 */

import { prisma } from "@/server/db";
import { STARTER_RULES } from "@/server/rules/starter-rules";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const orgArg = process.argv.indexOf("--org");
  const orgId = orgArg > -1 ? process.argv[orgArg + 1] : undefined;
  if (!orgId) {
    console.error("Användning: yarn tsx scripts/seed-rules.ts --org <orgId>");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    console.error(`Hittar ingen organisation med id ${orgId}`);
    process.exit(1);
  }

  console.log(`Seedar ${STARTER_RULES.length} regler för byrå "${org.name}" (${orgId})...`);

  for (const rule of STARTER_RULES) {
    await prisma.avaRule.upsert({
      where: { id: rule.id },
      update: {
        name: rule.name,
        description: rule.description,
        ownerId: rule.ownerId,
        enabled: rule.enabled,
        organizationId: orgId,
        triggerKind: rule.trigger.kind,
        triggerEventType: rule.trigger.kind === "event" ? rule.trigger.type : null,
        triggerCron: rule.trigger.kind === "schedule" ? rule.trigger.cron : null,
        triggerHttpPath: rule.trigger.kind === "http" ? rule.trigger.path : null,
        triggerHttpMethod: rule.trigger.kind === "http" ? rule.trigger.method : null,
        body: rule as never,
      },
      create: {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        ownerId: rule.ownerId,
        enabled: rule.enabled,
        organizationId: orgId,
        triggerKind: rule.trigger.kind,
        triggerEventType: rule.trigger.kind === "event" ? rule.trigger.type : null,
        triggerCron: rule.trigger.kind === "schedule" ? rule.trigger.cron : null,
        triggerHttpPath: rule.trigger.kind === "http" ? rule.trigger.path : null,
        triggerHttpMethod: rule.trigger.kind === "http" ? rule.trigger.method : null,
        body: rule as never,
      },
    });
    console.log(`  ✓ ${rule.id}  (${rule.trigger.kind})`);
  }

  console.log("Klart.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
