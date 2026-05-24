import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../../src/server/db";
import { rm } from "fs/promises";
import path from "path";

async function main() {
  const docs = await prisma.document.findMany({
    where: { fileName: { startsWith: "._" } },
    select: { id: true, fileName: true, fileSize: true, matterId: true, storagePath: true },
  });

  console.log(`Hittade ${docs.length} AppleDouble-dokument:`);
  for (const d of docs) {
    console.log(`  - ${d.fileName} (${d.fileSize} B) — matter ${d.matterId}`);
  }

  if (docs.length === 0) {
    await prisma.$disconnect();
    return;
  }

  for (const d of docs) {
    // Delete file from disk
    const abs = path.isAbsolute(d.storagePath)
      ? d.storagePath
      : path.resolve(process.cwd(), d.storagePath);
    try {
      await rm(path.dirname(abs), { recursive: true, force: true });
    } catch (e) {
      console.warn(`  (kunde inte ta bort ${abs}: ${e instanceof Error ? e.message : e})`);
    }
  }

  const r = await prisma.document.deleteMany({
    where: { id: { in: docs.map((d) => d.id) } },
  });
  console.log(`Raderade ${r.count} dokument från DB.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
