import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/server/db";

async function main() {
  // Clear stale "AI-nyckel saknas" markers so these docs can be re-analyzed
  // with the local LM Studio backend.
  const r = await prisma.document.updateMany({
    where: {
      OR: [
        { analysisError: { contains: "ANTHROPIC_API_KEY" } },
        { analysisError: { contains: "AI-nyckel saknas" } },
        { analysisError: { contains: "AI-analys var inte aktiverad" } },
      ],
    },
    data: { analyzedAt: null, analysisError: null },
  });
  console.log(`Återställde ${r.count} dokument för ny analys.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
