import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/server/db";
import { analyzeDocument } from "../src/server/services/document-analysis";

async function main() {
  const docs = await prisma.document.findMany({
    where: { analyzedAt: null, analysisError: null },
    select: { id: true, fileName: true },
  });

  console.log(`Hittade ${docs.length} oanalyserade dokument.`);
  for (const d of docs) {
    console.log(`  → ${d.fileName}`);
    await analyzeDocument(d.id);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
