/**
 * One-shot cleanup: remove Document rows created from macOS/Windows
 * junk sidecar files (AppleDouble `._*`, `.DS_Store`, `Thumbs.db`, …)
 * that accidentally got persisted before the WebDAV junk filter was
 * added. Safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { unlink } from "fs/promises";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const JUNK_NAMES = new Set([
  ".DS_Store", ".localized", ".hidden",
  ".Spotlight-V100", ".Trashes", ".fseventsd", ".TemporaryItems", ".apdisk",
  ".metadata_never_index", ".metadata_never_index_unless_rootfs",
  ".metadata_direct_scope_only",
  "Thumbs.db", "desktop.ini",
]);

const SB_TEMP_RE = /\.sb-[0-9a-f]{8}-[A-Za-z0-9]{6}$/;
function isJunk(name: string): boolean {
  return name.startsWith("._") || JUNK_NAMES.has(name) || SB_TEMP_RE.test(name);
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
  const allDocs = await prisma.document.findMany({ select: { id: true, fileName: true, storagePath: true } });
  const junkDocs = allDocs.filter((d) => isJunk(d.fileName));
  console.log(`Found ${junkDocs.length} junk documents out of ${allDocs.length} total`);
  for (const d of junkDocs) {
    const abs = path.isAbsolute(d.storagePath) ? d.storagePath : path.resolve(process.cwd(), d.storagePath);
    try { await unlink(abs); } catch { /* ignore */ }
    await prisma.document.delete({ where: { id: d.id } });
    console.log(`  removed doc: ${d.fileName}`);
  }

  // Repeat for folders. Delete recursively (depth-first) so child rows go first.
  async function deleteFolderRecursive(id: string) {
    const children = await prisma.documentFolder.findMany({ where: { parentId: id }, select: { id: true } });
    for (const c of children) await deleteFolderRecursive(c.id);
    const docs = await prisma.document.findMany({ where: { folderId: id }, select: { id: true, storagePath: true } });
    for (const d of docs) {
      const abs = path.isAbsolute(d.storagePath) ? d.storagePath : path.resolve(process.cwd(), d.storagePath);
      try { await unlink(abs); } catch { /* ignore */ }
      await prisma.document.delete({ where: { id: d.id } });
    }
    await prisma.documentFolder.delete({ where: { id } });
  }

  const allFolders = await prisma.documentFolder.findMany({ select: { id: true, name: true } });
  const junkFolders = allFolders.filter((f) => isJunk(f.name));
  console.log(`Found ${junkFolders.length} junk folders out of ${allFolders.length} total`);
  for (const f of junkFolders) {
    try {
      await deleteFolderRecursive(f.id);
      console.log(`  removed folder: ${f.name}`);
    } catch (e) {
      // Folder may already have been removed by a parent deletion.
      console.log(`  skipped folder (already gone): ${f.name}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
