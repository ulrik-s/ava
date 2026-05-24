/**
 * AVA debug-CLI. Operationer för att inspektera event-log och regler.
 *
 * Användning:
 *   yarn ava events tail --org <orgId> [--type <type>] [--limit N]
 *   yarn ava events replay --org <orgId> --since <iso> [--rule <ruleId>]
 *   yarn ava rules list --org <orgId>
 *   yarn ava rules enable --org <orgId> --id <ruleId>
 *   yarn ava rules disable --org <orgId> --id <ruleId>
 *
 * Inget destruktivt: replay läser events och kör regler igen, men skriver
 * effekter som NYA events (med causedBy → ursprungs-eventet).
 */

import { prisma } from "@/server/db";
import { PostgresStore } from "@/server/data-store/PostgresStore";
import { PostgresRuleLoader } from "@/server/rules/load";
import { matchEventTriggers } from "@/server/rules/match";
import { executeRule } from "@/server/rules/execute";
import { buildLiveHandlers } from "@/server/rules/handlers";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

function argOf(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}

async function eventsTail() {
  const orgId = required("--org");
  const type = argOf("--type");
  const limit = Number(argOf("--limit", "20"));
  const ds = PostgresStore.forOrganization(prisma, orgId);
  const events = await ds.events.query({
    ...(type ? { type: type as never } : {}),
    limit,
  });
  for (const e of events.slice(-limit)) {
    console.log(
      `${e.ts}  ${e.type.padEnd(28)}  actor=${e.actor.id.padEnd(10)}  matter=${(e.matterId ?? "-").padEnd(20)}  ${JSON.stringify(e.payload)}`,
    );
  }
  console.log(`\n${events.length} events.`);
}

async function eventsReplay() {
  const orgId = required("--org");
  const since = required("--since");
  const ruleFilter = argOf("--rule");

  const ds = PostgresStore.forOrganization(prisma, orgId);
  const loader = new PostgresRuleLoader(prisma, orgId);
  let rules = await loader.loadEnabled();
  if (ruleFilter) rules = rules.filter((r) => r.id === ruleFilter);
  if (!rules.length) {
    console.error("Inga matchande aktiverade regler.");
    process.exit(1);
  }

  const handlers = buildLiveHandlers({ prisma, dataStore: ds, organizationId: orgId });
  const events = await ds.events.query({ since, limit: 10_000 });
  console.log(`Replay: ${events.length} events × ${rules.length} regler`);

  let executed = 0;
  for (const event of events) {
    const matched = matchEventTriggers(rules, event);
    for (const rule of matched) {
      console.log(`  ▶ ${rule.id} på ${event.id} (${event.type})`);
      await executeRule({ rule, event, dataStore: ds, handlers });
      executed++;
    }
  }
  console.log(`Klart. Exekverade ${executed} regel-event-par.`);
}

async function rulesList() {
  const orgId = required("--org");
  const rows = await prisma.avaRule.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    const enabled = r.enabled ? "✓" : " ";
    console.log(`  ${enabled}  ${r.id.padEnd(50)} ${r.triggerKind}`);
  }
}

async function rulesSetEnabled(enabled: boolean) {
  const orgId = required("--org");
  const id = required("--id");
  await prisma.avaRule.updateMany({
    where: { id, organizationId: orgId },
    data: { enabled },
  });
  console.log(`${id} → ${enabled ? "ENABLED" : "DISABLED"}`);
}

function required(name: string): string {
  const v = argOf(name);
  if (!v) {
    console.error(`Saknar argument: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const [cmd, sub] = process.argv.slice(2);
  switch (`${cmd} ${sub}`) {
    case "events tail": return await eventsTail();
    case "events replay": return await eventsReplay();
    case "rules list": return await rulesList();
    case "rules enable": return await rulesSetEnabled(true);
    case "rules disable": return await rulesSetEnabled(false);
    default:
      console.log("Användning: yarn ava <events tail|events replay|rules list|rules enable|rules disable> [...args]");
      process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
