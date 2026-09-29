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

import { bytesToBase64 } from "@/lib/shared/content-address";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { clientFor, seedUser, waitForServer } from "./e2e-harness";

const USER = "drill@byra.se";

async function main(): Promise<void> {
  const userId = await seedUser(USER, "Återställningsövning");
  const c = clientFor(USER);
  await waitForServer(c);

  const marker = `DRILL-${Date.now().toString(36)}`;
  const matter = await c.matter.create.mutate({
    matterNumber: marker,
    title: "Återställningsövning — markör",
    matterType: "Allmän praktik",
    paymentMethod: "PRIVAT",
    responsibleLawyerId: userId,
  });

  // Ett dokument med riktigt innehåll (#1254): backup-verify.sh kontrollerar att
  // varje dokument databasen pekar på finns i den krypterade exportens
  // dokumentarkiv — utan ett uppladdat dokument vore den kontrollen tom.
  const documentId = uuidv7();
  const bytes = new TextEncoder().encode(`Återställningsövning ${marker}`);
  await c.document.register.mutate({
    id: documentId, matterId: matter.id, fileName: `${marker}.txt`, mimeType: "text/plain",
    sizeBytes: bytes.byteLength, storagePath: `documents/content/${documentId}.txt`,
  });
  await c.document.uploadContent.mutate({ documentId: asId<"DocumentId">(documentId), contentBase64: bytesToBase64(bytes) });

  // Bara markören på stdout — scriptet läser den rakt av.
  console.log(marker);
}

main().catch((e: unknown) => {
  console.error(`markör-ärendet kunde inte skapas: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
