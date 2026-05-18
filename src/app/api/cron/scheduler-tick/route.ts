/**
 * Cron-endpoint: trigger för regelmotorns scheduler.
 *
 * Tänkt körs ~varje minut av extern schemaläggare (systemd-timer,
 * k8s CronJob, Vercel Cron, macOS launchd, eller en intern setInterval).
 *
 * För varje organisation:
 *   1. Ladda alla aktiverade `schedule`-triggers
 *   2. Beräkna missade ticks i lookback-fönstret (default 1h)
 *   3. Kör varje tick som inte redan körts (idempotency-key i event-loggen)
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 *
 * Returnerar JSON med räknare per byrå för observability.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { PostgresStore } from "@/server/data-store/PostgresStore";
import { PostgresRuleLoader } from "@/server/rules/load";
import {
  runScheduledTick,
  alreadyRanFromEventLog,
} from "@/server/rules/scheduler";
import { buildLiveHandlers } from "@/server/rules/handlers";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET är inte satt på servern." },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Otillåten" }, { status: 401 });
  }

  // Loopa alla aktiva organisationer. Vi sätter ingen filter — om det blir
  // tungt i framtiden kan man partitionera per org-shard.
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  const perOrg: Array<{
    organizationId: string;
    name: string;
    rulesChecked: number;
    ticksFound: number;
    ticksExecuted: number;
    ticksSkipped: number;
  }> = [];

  for (const org of orgs) {
    const dataStore = PostgresStore.forOrganization(prisma, org.id);
    const loader = new PostgresRuleLoader(prisma, org.id);
    const rules = await loader.loadEnabled();
    const handlers = buildLiveHandlers({
      prisma,
      dataStore,
      organizationId: org.id,
    });

    const result = await runScheduledTick({
      rules,
      dataStore,
      handlers,
      alreadyRan: alreadyRanFromEventLog(dataStore),
    });

    perOrg.push({ organizationId: org.id, name: org.name, ...result });
  }

  const totals = perOrg.reduce(
    (acc, x) => ({
      rulesChecked: acc.rulesChecked + x.rulesChecked,
      ticksFound: acc.ticksFound + x.ticksFound,
      ticksExecuted: acc.ticksExecuted + x.ticksExecuted,
      ticksSkipped: acc.ticksSkipped + x.ticksSkipped,
    }),
    { rulesChecked: 0, ticksFound: 0, ticksExecuted: 0, ticksSkipped: 0 },
  );

  return NextResponse.json({ ok: true, totals, perOrg });
}
