/**
 * `populateUnbilledTime` — körs EFTER `populateBilling` och skapar
 * färska time-entries på aktiva ärenden som *inte* länkas till någon
 * faktura. Simulerar "upparbetad tid sedan senaste faktureringen" —
 * en realistisk vy av en advokatbyrås löpande arbete.
 *
 * Backend-agnostiskt: går via tRPC-API:t precis som övriga populate-
 * funktioner. Postgres-backenden kommer fungera utan ändringar.
 */
import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;
type Row = Record<string, unknown>;

const FRESH_TASKS = [
  "Klientmöte (uppdatering)",
  "Granskning inkommande material",
  "Telefon med klient",
  "Avstämning motpart",
  "Förberedelse inför nästa steg",
  "Inläsning ärendet",
];

function recentDate(daysAgo: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function entriesPerMatter(mi: number): number {
  return 2 + (mi % 2); // 2 eller 3
}

async function createFreshEntry(
  c: AnyCaller,
  user: Row,
  matter: Row,
  daysAgo: number,
  taskIdx: number,
): Promise<void> {
  await c.timeEntry.create({
    userId: user.id,
    matterId: matter.id,
    date: recentDate(daysAgo, 9 + (taskIdx % 7)).toISOString(),
    minutes: 30 + ((taskIdx * 15) % 75),
    description: FRESH_TASKS[taskIdx % FRESH_TASKS.length],
    billable: true,
    hourlyRate: user.hourlyRate,
    // invoiceId utelämnas → entry är "upparbetad men inte fakturerad"
  });
}

export async function populateUnbilledTime(caller: GeneratorCaller, seed: SeedDataset): Promise<number> {
  const c = caller as AnyCaller;
  const users = (seed.users ?? []) as Row[];
  const activeMatters = ((seed.matters ?? []) as Row[]).filter((m) => m.status === "ACTIVE");
  if (users.length === 0 || activeMatters.length === 0) return 0;

  let count = 0;
  for (let mi = 0; mi < activeMatters.length; mi++) {
    const matter = activeMatters[mi];
    const n = entriesPerMatter(mi);
    for (let j = 0; j < n; j++) {
      const user = users[(mi + j) % users.length];
      await createFreshEntry(c, user, matter, j + 1, mi * 3 + j);
      count++;
    }
  }
  return count;
}
