import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/server/db";

async function main() {
  const r = await prisma.document.updateMany({
    where: {
      OR: [
        { analysisError: { contains: "LM Studio" } },
        { analysisError: { contains: "LLM" } },
        { analysisError: { contains: "JSON" } },
      ],
    },
    data: { analyzedAt: null, analysisError: null },
  });
  console.log(`Återställde ${r.count} dokument.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
