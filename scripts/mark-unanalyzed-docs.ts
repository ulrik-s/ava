import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/server/db";

async function main() {
  const r = await prisma.document.updateMany({
    where: { analyzedAt: null, analysisError: null },
    data: {
      analyzedAt: new Date(),
      analysisError:
        "AI-analys var inte aktiverad när dokumentet laddades upp. Klicka 🧠 Analysera för att köra nu.",
    },
  });
  console.log(`Markerade ${r.count} gamla dokument.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
