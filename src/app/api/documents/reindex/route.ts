import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { readFile } from "fs/promises";
import { extractText } from "@/server/services/tika";
import { indexDocument } from "@/server/services/meilisearch";

export async function POST() {
  const documents = await prisma.document.findMany({
    include: {
      matter: {
        select: { matterNumber: true, title: true, organizationId: true },
      },
    },
  });

  let indexed = 0;
  let failed = 0;

  for (const doc of documents) {
    try {
      const buffer = await readFile(doc.storagePath);
      const content = await extractText(buffer, doc.mimeType);
      await indexDocument({
        id: doc.id,
        fileName: doc.fileName,
        content,
        matterId: doc.matterId,
        matterNumber: doc.matter.matterNumber,
        matterTitle: doc.matter.title,
        organizationId: doc.matter.organizationId,
      });
      indexed++;
    } catch (err) {
      console.error(`Failed to index ${doc.fileName}:`, err);
      failed++;
    }
  }

  return NextResponse.json({ total: documents.length, indexed, failed });
}
