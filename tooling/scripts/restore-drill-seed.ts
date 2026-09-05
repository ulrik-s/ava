#!/usr/bin/env bun
/**
 * Markör-ärende för återställningsövningen (#1079).
 *
 * Skapar ETT ärende via det riktiga API:t och skriver dess ärendenummer på
 * stdout, så `restore-drill.sh` kan leta efter exakt den raden före och efter
 * återställningen.
 *
 * Varför via API:t och inte ett `INSERT`: en rad som skrivits förbi
 * applikationen bevisar bara att `pg_dump` kopierar tabeller. Går ärendet
 * genom `matter.create` täcker övningen också att det som faktiskt skrivs vid
 * normal drift kommer tillbaka — inklusive kolumner en framtida migration
 * lägger till.
 */

import { clientFor, seedUser, waitForServer } from "./e2e-harness";

const USER = "drill@byra.se";

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Återställningsövning");
  const c = clientFor(USER);
  await waitForServer(c);

  const marker = `DRILL-${Date.now().toString(36)}`;
  await c.matter.create.mutate({
    matterNumber: marker,
    title: "Återställningsövning — markör",
    matterType: "Allmän praktik",
    paymentMethod: "PRIVAT",
    responsibleLawyerId: userId,
  });

  // Bara markören på stdout — scriptet läser den rakt av.
  console.log(marker);
}

main().catch((e: unknown) => {
  console.error(`markör-ärendet kunde inte skapas: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
