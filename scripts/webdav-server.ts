/**
 * AVA WebDAV Server
 * ==================
 *
 * Standalone HTTP server that exposes the organization's document folders
 * as a WebDAV share. Users mount it in Finder (Mac) or Explorer (Windows)
 * and edit files natively; saves are written back to storage automatically.
 *
 * URL layout:
 *
 *   /  (root)
 *   ├── 2024-0001 - Exempelärende/
 *   │   ├── Inlagor/
 *   │   │   └── Stämning.pdf
 *   │   └── Uppdragsavtal.pdf
 *   └── 2024-0042 - Annat ärende/
 *       └── …
 *
 * Supported methods: OPTIONS, PROPFIND, GET, HEAD, PUT, LOCK, UNLOCK,
 *                    MKCOL, DELETE.
 *
 * Auth: HTTP Basic against User.email + bcrypt(passwordHash). A user
 * only sees matters belonging to their own organization.
 *
 * Run with:  npm run dev:webdav
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createReadStream, appendFileSync } from "fs";
import { readFile, writeFile, mkdir, stat, unlink } from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { compare } from "bcryptjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

// Fire-and-forget AI analysis — lazy-imports the service so startup stays fast
// and missing ANTHROPIC_API_KEY doesn't break WebDAV.
function triggerAnalysis(documentId: string): void {
  import("../src/server/services/document-analysis")
    .then(({ analyzeDocument }) => analyzeDocument(documentId))
    .catch((err) => console.error("[webdav] analysis trigger failed:", err));
}

// ────────────────────────────────────────────────────────────────
// Config & Prisma
// ────────────────────────────────────────────────────────────────

const PORT = Number(process.env.WEBDAV_PORT ?? 3001);
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT ?? "./storage/documents");

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

type User = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>>;

// ────────────────────────────────────────────────────────────────
// Helpers — URL parsing, slugs, XML escaping
// ────────────────────────────────────────────────────────────────

/** Split decoded path "/a/b/c" into segments ["a","b","c"]. Empty for root.
 *
 * Normaliserar till NFC (composed Unicode) — macOS Finder skickar filnamn
 * i NFD (t.ex. "å" som a + combining ring), medan databasen lagrar NFC.
 * Utan denna normalisering 404:ar matters/mappar/filer med svenska tecken
 * slumpmässigt beroende på client.
 */
function splitPath(urlPath: string): string[] {
  const decoded = decodeURIComponent(urlPath).normalize("NFC");
  return decoded.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

/** Escape a raw filename/path to a valid URL segment. */
function encodeSegment(s: string): string {
  return encodeURIComponent(s);
}

/** XML escape. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC 1123 date. */
function httpDate(d: Date | string): string {
  return new Date(d).toUTCString();
}

/** Swedish-safe matter slug: "2024-0001 - Title" — normaliserat till NFC. */
function matterSlug(m: { matterNumber: string; title: string }): string {
  const safeTitle = m.title.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 80);
  return `${m.matterNumber} - ${safeTitle}`.normalize("NFC");
}

// ────────────────────────────────────────────────────────────────
// Junk-file filter
// ────────────────────────────────────────────────────────────────
//
// macOS / Windows / Spotlight write lots of metadata sidecar files
// (`._name`, `.DS_Store`, `Thumbs.db`, …). Without special handling
// they'd be PUT as real documents into the DB, polluting the document
// browser and search index. We intercept them and store the bodies
// in-memory only — enough for the OS to read back its own xattrs
// within a session, but they never reach storage or Prisma.

// macOS atomic safe-save creates nested temp dirs/files with names like
// `foo.pdf.sb-b1c3131b-pZl8T8`. They're transient — PDF apps PUT the new
// version here, then MOVE it over the original. We treat them as junk so
// they don't touch the DB; MOVE promotes the junk body to the real doc.
const SB_TEMP_RE = /\.sb-[0-9a-f]{8}-[A-Za-z0-9]{6}$/;

function isJunkFile(name: string): boolean {
  if (name.startsWith("._")) return true;           // AppleDouble
  if (SB_TEMP_RE.test(name)) return true;           // macOS safe-save temp
  return (
    name === ".DS_Store" ||
    name === ".localized" ||
    name === ".hidden" ||
    name === ".Spotlight-V100" ||
    name === ".Trashes" ||
    name === ".fseventsd" ||
    name === ".TemporaryItems" ||
    name === ".apdisk" ||
    name === ".metadata_never_index" ||
    name === ".metadata_never_index_unless_rootfs" ||
    name === ".metadata_direct_scope_only" ||
    name === "Thumbs.db" ||
    name === "desktop.ini"
  );
}

/** Any segment in the path is junk → path is junk. */
function isJunkPath(urlPath: string): boolean {
  return splitPath(urlPath).some(isJunkFile);
}

interface JunkEntry { body: Buffer; contentType: string; modifiedAt: Date; }
const JUNK_TTL_MS = 60 * 60_000;
const junkStore = new Map<string, { entry: JunkEntry; expiresAt: number }>();

function junkKey(urlPath: string): string {
  return decodeURIComponent(urlPath).replace(/\/+$/, "");
}
function junkGet(urlPath: string): JunkEntry | null {
  const k = junkKey(urlPath);
  const hit = junkStore.get(k);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { junkStore.delete(k); return null; }
  return hit.entry;
}
function junkSet(urlPath: string, entry: JunkEntry) {
  const k = junkKey(urlPath);
  junkStore.set(k, { entry, expiresAt: Date.now() + JUNK_TTL_MS });
  if (junkStore.size > 512) {
    const now = Date.now();
    for (const [key, v] of junkStore) if (v.expiresAt <= now) junkStore.delete(key);
  }
}
function junkDelete(urlPath: string) {
  junkStore.delete(junkKey(urlPath));
  junkCollections.delete(junkKey(urlPath));
}

/** Junk directories (MKCOL'd by macOS safe-save) — tracked in memory only. */
const junkCollections = new Set<string>();
function junkCollectionHas(urlPath: string): boolean {
  return junkCollections.has(junkKey(urlPath));
}
function junkCollectionAdd(urlPath: string) {
  junkCollections.add(junkKey(urlPath));
}

// ────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────

// Auth cache: bcrypt is ~50-100ms per compare, and macOS Finder fires 10+
// WebDAV requests per file operation. Without caching, opening a single PDF
// can spend 1+ second just re-hashing the same password. Key is a hash of
// the raw Authorization header so we never store plaintext credentials.
const AUTH_TTL_MS = 5 * 60_000;
const authCache = new Map<string, { userId: string; expiresAt: number }>();

function cacheKey(authHeader: string): string {
  return crypto.createHash("sha256").update(authHeader).digest("hex");
}

async function authenticate(req: IncomingMessage): Promise<User | null> {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;

  const key = cacheKey(header);
  const now = Date.now();
  const cached = authCache.get(key);
  if (cached && cached.expiresAt > now) {
    const user = await prisma.user.findUnique({ where: { id: cached.userId } });
    if (user) return user;
    authCache.delete(key);
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  const email = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return null;
  const ok = await compare(password, user.passwordHash);
  if (!ok) return null;

  authCache.set(key, { userId: user.id, expiresAt: now + AUTH_TTL_MS });
  // Opportunistic cleanup to keep the map bounded.
  if (authCache.size > 128) {
    for (const [k, v] of authCache) if (v.expiresAt <= now) authCache.delete(k);
  }
  return user;
}

function requireAuth(res: ServerResponse) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="AVA WebDAV", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Unauthorized");
}

// ────────────────────────────────────────────────────────────────
// Path resolver
// ────────────────────────────────────────────────────────────────
//
// Resolves a WebDAV URL path like
//   ["2024-0001 - Exempel", "Inlagor", "Stämning.pdf"]
// to a concrete resource in the database.
//
// Returns one of:
//   { kind: "root" }                                 — "/"
//   { kind: "matter", matter }                       — "/<matter>"
//   { kind: "folder", matter, folder }               — "/<matter>/<…>/<folder>"
//   { kind: "document", matter, folder, document }   — "/<matter>/<…>/<file>"
//   { kind: "missing-in-folder", matter, folder, name } — PUT target that
//                                                         doesn't exist yet
//   { kind: "not-found" }

interface MatterNode {
  id: string;
  matterNumber: string;
  title: string;
  organizationId: string;
}
interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  matterId: string;
  createdAt: Date;
}
interface DocumentNode {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  version: number;
  matterId: string;
  folderId: string | null;
  createdAt: Date;
}

type Resolved =
  | { kind: "root" }
  | { kind: "matter"; matter: MatterNode }
  | { kind: "folder"; matter: MatterNode; folder: FolderNode | null }
  | { kind: "document"; matter: MatterNode; folder: FolderNode | null; document: DocumentNode }
  | { kind: "missing-in-folder"; matter: MatterNode; folder: FolderNode | null; name: string }
  | { kind: "not-found" };

async function findMatterBySlug(slug: string, user: User): Promise<MatterNode | null> {
  const allMatters = await prisma.matter.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, matterNumber: true, title: true, organizationId: true },
  });
  return allMatters.find((m) => matterSlug(m) === slug) ?? null;
}

async function traverseFolders(
  matterId: string,
  segments: string[],
): Promise<FolderNode | null | "not-found"> {
  let currentFolder: FolderNode | null = null;
  for (const name of segments) {
    const siblings: FolderNode[] = await prisma.documentFolder.findMany({
      where: { matterId, parentId: currentFolder?.id ?? null },
    });
    const found = siblings.find((f) => f.name.normalize("NFC") === name) ?? null;
    if (!found) return "not-found";
    currentFolder = found;
  }
  return currentFolder;
}

async function resolvePath(segments: string[], user: User): Promise<Resolved> {
  if (segments.length === 0) return { kind: "root" };

  const matter = await findMatterBySlug(segments[0], user);
  if (!matter) return { kind: "not-found" };
  if (segments.length === 1) return { kind: "matter", matter };

  const folderSegments = segments.slice(1, -1);
  const traversal = await traverseFolders(matter.id, folderSegments);
  if (traversal === "not-found") return { kind: "not-found" };
  const currentFolder = traversal;

  const lastName = segments[segments.length - 1];

  const folderSiblings = await prisma.documentFolder.findMany({
    where: { matterId: matter.id, parentId: currentFolder?.id ?? null },
  });
  const folderMatch = folderSiblings.find((f) => f.name.normalize("NFC") === lastName) ?? null;
  if (folderMatch) return { kind: "folder", matter, folder: folderMatch };

  const docSiblings = await prisma.document.findMany({
    where: { matterId: matter.id, folderId: currentFolder?.id ?? null },
  });
  const docMatch = docSiblings.find((d) => d.fileName.normalize("NFC") === lastName) ?? null;
  if (docMatch) return { kind: "document", matter, folder: currentFolder, document: docMatch };

  return { kind: "missing-in-folder", matter, folder: currentFolder, name: lastName };
}

// ────────────────────────────────────────────────────────────────
// PROPFIND XML builder
// ────────────────────────────────────────────────────────────────

interface PropEntry {
  href: string;            // URL-encoded path, ends with "/" for collections
  displayName: string;
  isCollection: boolean;
  size?: number;
  contentType?: string;
  lastModified?: Date;
  created?: Date;
  etag?: string;
}

function multistatus(entries: PropEntry[]): string {
  const body = entries.map((e) => {
    const propstat = e.isCollection
      ? `
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getcontentlength>0</D:getcontentlength>`
      : `
        <D:resourcetype/>
        <D:getcontentlength>${e.size ?? 0}</D:getcontentlength>
        <D:getcontenttype>${xmlEscape(e.contentType ?? "application/octet-stream")}</D:getcontenttype>`;
    return `
  <D:response>
    <D:href>${e.href}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${xmlEscape(e.displayName)}</D:displayname>${propstat}
        ${e.lastModified ? `<D:getlastmodified>${httpDate(e.lastModified)}</D:getlastmodified>` : ""}
        ${e.created ? `<D:creationdate>${new Date(e.created).toISOString()}</D:creationdate>` : ""}
        ${e.etag ? `<D:getetag>"${e.etag}"</D:getetag>` : ""}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
  }).join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">${body}
</D:multistatus>`;
}

// ────────────────────────────────────────────────────────────────
// PROPFIND — list resources
// ────────────────────────────────────────────────────────────────

async function buildRootEntries(user: User, includeChildren: boolean): Promise<PropEntry[]> {
  const entries: PropEntry[] = [{ href: "/", displayName: "/", isCollection: true }];
  if (!includeChildren) return entries;
  const matters = await prisma.matter.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { matterNumber: "asc" },
  });
  for (const m of matters) {
    const name = matterSlug(m);
    entries.push({
      href: "/" + encodeSegment(name) + "/",
      displayName: name,
      isCollection: true,
      lastModified: m.updatedAt,
      created: m.createdAt,
    });
  }
  return entries;
}

async function buildCollectionEntries(
  matterId: string,
  folderId: string | null,
  selfHref: string,
  hrefPrefix: string,
  selfName: string,
  includeChildren: boolean,
): Promise<PropEntry[]> {
  const entries: PropEntry[] = [{
    href: selfHref + "/",
    displayName: selfName,
    isCollection: true,
  }];
  if (!includeChildren) return entries;
  const [childFolders, childDocs] = await Promise.all([
    prisma.documentFolder.findMany({ where: { matterId, parentId: folderId }, orderBy: { name: "asc" } }),
    prisma.document.findMany({ where: { matterId, folderId }, orderBy: { fileName: "asc" } }),
  ]);
  for (const f of childFolders) {
    entries.push({
      href: hrefPrefix + encodeSegment(f.name) + "/",
      displayName: f.name,
      isCollection: true,
      created: f.createdAt,
    });
  }
  for (const d of childDocs) {
    entries.push({
      href: hrefPrefix + encodeSegment(d.fileName),
      displayName: d.fileName,
      isCollection: false,
      size: d.fileSize,
      contentType: d.mimeType,
      lastModified: d.createdAt,
      created: d.createdAt,
      etag: `${d.id}-v${d.version}`,
    });
  }
  return entries;
}

async function handlePROPFIND(req: IncomingMessage, res: ServerResponse, user: User) {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const segments = splitPath(urlPath);
  const depth = (req.headers.depth as string) ?? "1";
  const includeChildren = depth !== "0";
  const resolved = await resolvePath(segments, user);

  if (resolved.kind === "not-found" || resolved.kind === "missing-in-folder") {
    res.writeHead(404).end("Not Found");
    return;
  }

  const hrefPrefix = "/" + segments.map(encodeSegment).join("/") + (segments.length ? "/" : "");
  const selfHref = hrefPrefix.replace(/\/$/, "") || "/";
  let entries: PropEntry[] = [];

  if (resolved.kind === "root") {
    entries = await buildRootEntries(user, includeChildren);
  } else if (resolved.kind === "matter" || resolved.kind === "folder") {
    const folderId = resolved.kind === "folder" ? resolved.folder?.id ?? null : null;
    entries = await buildCollectionEntries(
      resolved.matter.id,
      folderId,
      selfHref,
      hrefPrefix,
      segments[segments.length - 1] ?? "/",
      includeChildren,
    );
  } else if (resolved.kind === "document") {
    const d = resolved.document;
    entries.push({
      href: selfHref,
      displayName: d.fileName,
      isCollection: false,
      size: d.fileSize,
      contentType: d.mimeType,
      lastModified: d.createdAt,
      created: d.createdAt,
      etag: `${d.id}-v${d.version}`,
    });
  }

  res.writeHead(207, {
    "Content-Type": 'application/xml; charset="utf-8"',
    "DAV": "1, 2",
  });
  res.end(multistatus(entries));
}

// ────────────────────────────────────────────────────────────────
// GET / HEAD
// ────────────────────────────────────────────────────────────────

async function handleGET(req: IncomingMessage, res: ServerResponse, user: User, method: "GET" | "HEAD") {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const resolved = await resolvePath(splitPath(urlPath), user);

  if (resolved.kind !== "document") {
    res.writeHead(resolved.kind === "not-found" ? 404 : 405).end();
    return;
  }

  const d = resolved.document;
  const absPath = path.isAbsolute(d.storagePath)
    ? d.storagePath
    : path.resolve(process.cwd(), d.storagePath);

  let s;
  try {
    s = await stat(absPath);
  } catch {
    res.writeHead(404).end();
    return;
  }

  // Parse Range header — many PDF readers request bytes=0-0 or the trailer
  // first, so we need to support 206 Partial Content or they give up with
  // "file doesn't exist" style errors.
  const rangeHeader = req.headers["range"];
  const commonHeaders: Record<string, string> = {
    "Content-Type": d.mimeType,
    "Last-Modified": httpDate(d.createdAt),
    "ETag": `"${d.id}-v${d.version}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : s.size - 1;
      if (!m[1] && m[2]) {
        // Suffix: last N bytes
        start = Math.max(0, s.size - Number(m[2]));
        end = s.size - 1;
      }
      if (start > end || start >= s.size) {
        res.writeHead(416, { ...commonHeaders, "Content-Range": `bytes */${s.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...commonHeaders,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${s.size}`,
      });
      if (method === "HEAD") return res.end();
      createReadStream(absPath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...commonHeaders, "Content-Length": String(s.size) });
  if (method === "HEAD") return res.end();
  createReadStream(absPath).pipe(res);
}

// ────────────────────────────────────────────────────────────────
// PUT — create or overwrite a file
// ────────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mimeFromExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".html": "text/html",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

async function handlePUT(req: IncomingMessage, res: ServerResponse, user: User) {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const segments = splitPath(urlPath);
  if (segments.length < 2) {
    // Can't PUT at root or directly under root — need at least matter + file
    res.writeHead(403).end("Cannot create files at this level");
    return;
  }

  const resolved = await resolvePath(segments, user);
  const body = await readBody(req);

  if (resolved.kind === "document") {
    // Update existing file: write same storagePath, bump version
    const d = resolved.document;
    const absPath = path.isAbsolute(d.storagePath)
      ? d.storagePath
      : path.resolve(process.cwd(), d.storagePath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, body);
    await prisma.document.update({
      where: { id: d.id },
      data: { fileSize: body.length, version: d.version + 1 },
    });
    triggerAnalysis(d.id);
    res.writeHead(204).end();
    return;
  }

  if (resolved.kind === "missing-in-folder") {
    // Create new document
    const fileName = resolved.name;
    const mime = mimeFromExt(fileName);
    const docId = crypto.randomUUID();
    const dir = path.join(STORAGE_ROOT, resolved.matter.id, docId);
    const absPath = path.join(dir, fileName);
    await mkdir(dir, { recursive: true });
    await writeFile(absPath, body);
    const created = await prisma.document.create({
      data: {
        fileName,
        mimeType: mime,
        fileSize: body.length,
        storagePath: path.relative(process.cwd(), absPath),
        version: 1,
        matterId: resolved.matter.id,
        folderId: resolved.folder?.id ?? null,
        uploadedById: user.id,
      },
    });
    triggerAnalysis(created.id);
    res.writeHead(201).end();
    return;
  }

  res.writeHead(409).end("Conflict");
}

// ────────────────────────────────────────────────────────────────
// DELETE
// ────────────────────────────────────────────────────────────────

async function handleDELETE(req: IncomingMessage, res: ServerResponse, user: User) {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const resolved = await resolvePath(splitPath(urlPath), user);

  if (resolved.kind === "document") {
    const d = resolved.document;
    const absPath = path.isAbsolute(d.storagePath)
      ? d.storagePath
      : path.resolve(process.cwd(), d.storagePath);
    try { await unlink(absPath); } catch { /* ignore */ }
    await prisma.document.delete({ where: { id: d.id } });
    res.writeHead(204).end();
    return;
  }

  if (resolved.kind === "folder" && resolved.folder) {
    // Only delete if empty
    const [childF, childD] = await Promise.all([
      prisma.documentFolder.count({ where: { parentId: resolved.folder.id } }),
      prisma.document.count({ where: { folderId: resolved.folder.id } }),
    ]);
    if (childF + childD > 0) {
      res.writeHead(409).end("Folder not empty");
      return;
    }
    await prisma.documentFolder.delete({ where: { id: resolved.folder.id } });
    res.writeHead(204).end();
    return;
  }

  res.writeHead(404).end();
}

// ────────────────────────────────────────────────────────────────
// MKCOL — create folder
// ────────────────────────────────────────────────────────────────

async function handleMKCOL(req: IncomingMessage, res: ServerResponse, user: User) {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const segments = splitPath(urlPath);
  if (segments.length < 2) {
    res.writeHead(403).end();
    return;
  }
  const resolved = await resolvePath(segments, user);
  if (resolved.kind !== "missing-in-folder") {
    res.writeHead(resolved.kind === "not-found" ? 409 : 405).end();
    return;
  }
  await prisma.documentFolder.create({
    data: {
      name: resolved.name,
      matterId: resolved.matter.id,
      parentId: resolved.folder?.id ?? null,
    },
  });
  res.writeHead(201).end();
}

// ────────────────────────────────────────────────────────────────
// MOVE — rename or move a document/folder (non-junk paths)
// ────────────────────────────────────────────────────────────────

async function moveDocumentOverwrite(
  src: Extract<Resolved, { kind: "document" }>,
  dst: Extract<Resolved, { kind: "document" }>,
): Promise<void> {
  const srcAbs = path.isAbsolute(src.document.storagePath)
    ? src.document.storagePath : path.resolve(process.cwd(), src.document.storagePath);
  const dstAbs = path.isAbsolute(dst.document.storagePath)
    ? dst.document.storagePath : path.resolve(process.cwd(), dst.document.storagePath);
  const body = await readFile(srcAbs);
  await writeFile(dstAbs, body);
  await prisma.document.update({
    where: { id: dst.document.id },
    data: { fileSize: body.length, version: dst.document.version + 1 },
  });
  try { await unlink(srcAbs); } catch { /* ignore */ }
  await prisma.document.delete({ where: { id: src.document.id } });
}

async function moveDocumentToNew(
  src: Extract<Resolved, { kind: "document" }>,
  dst: Extract<Resolved, { kind: "missing-in-folder" }>,
): Promise<void> {
  await prisma.document.update({
    where: { id: src.document.id },
    data: {
      fileName: dst.name,
      folderId: dst.folder?.id ?? null,
      matterId: dst.matter.id,
    },
  });
}

async function handleMOVE(req: IncomingMessage, res: ServerResponse, user: User) {
  const urlPath = new URL(req.url!, "http://x").pathname;
  const destHeader = (req.headers["destination"] as string | undefined) ?? "";
  const overwrite = ((req.headers["overwrite"] as string | undefined) ?? "T").toUpperCase() !== "F";
  if (!destHeader) { res.writeHead(400).end(); return; }

  let destPath: string;
  try { destPath = new URL(destHeader, "http://x").pathname; }
  catch { res.writeHead(400).end(); return; }

  const src = await resolvePath(splitPath(urlPath), user);
  const dst = await resolvePath(splitPath(destPath), user);

  if (dst.kind === "root" || dst.kind === "not-found") {
    res.writeHead(409).end(); return;
  }

  if (src.kind === "document" && dst.kind === "document") {
    if (!overwrite) { res.writeHead(412).end(); return; }
    await moveDocumentOverwrite(src, dst);
    res.writeHead(204).end();
    return;
  }

  if (src.kind === "document" && dst.kind === "missing-in-folder") {
    await moveDocumentToNew(src, dst);
    res.writeHead(201).end();
    return;
  }

  if (src.kind === "folder" && src.folder && dst.kind === "missing-in-folder") {
    await prisma.documentFolder.update({
      where: { id: src.folder.id },
      data: {
        name: dst.name,
        parentId: dst.folder?.id ?? null,
        matterId: dst.matter.id,
      },
    });
    res.writeHead(201).end();
    return;
  }

  res.writeHead(409).end();
}

// ────────────────────────────────────────────────────────────────
// LOCK / UNLOCK — stub (macOS Preview/PDFGear require valid responses)
// ────────────────────────────────────────────────────────────────

function handleLOCK(req: IncomingMessage, res: ServerResponse) {
  const token = `opaquelocktoken:${crypto.randomUUID()}`;
  const timeout = req.headers["timeout"] ?? "Second-3600";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:timeout>${timeout}</D:timeout>
      <D:locktoken><D:href>${token}</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
  res.writeHead(200, {
    "Content-Type": 'application/xml; charset="utf-8"',
    "Lock-Token": `<${token}>`,
  });
  res.end(xml);
}

function handleUNLOCK(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(204).end();
}

// ────────────────────────────────────────────────────────────────
// OPTIONS — announce capabilities
// ────────────────────────────────────────────────────────────────

function handleOPTIONS(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    "DAV": "1, 2",
    "MS-Author-Via": "DAV",
    "Allow": "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK, MOVE",
    "Content-Length": "0",
  });
  res.end();
}

// ────────────────────────────────────────────────────────────────
// Junk-file handler (AppleDouble, .DS_Store, Thumbs.db, …)
// ────────────────────────────────────────────────────────────────
//
// Returns true if the request was handled (response written).

async function handleJunkPut(req: IncomingMessage, res: ServerResponse, urlPath: string, name: string) {
  const body = await readBody(req);
  junkSet(urlPath, {
    body,
    contentType: mimeFromExt(name) || "application/octet-stream",
    modifiedAt: new Date(),
  });
  // Match original behavior: always 204 since junkGet runs after junkSet.
  res.writeHead(junkGet(urlPath) ? 204 : 201).end();
}

function handleJunkGet(res: ServerResponse, urlPath: string, method: "GET" | "HEAD") {
  const e = junkGet(urlPath);
  if (!e) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    "Content-Type": e.contentType,
    "Content-Length": String(e.body.length),
    "Last-Modified": httpDate(e.modifiedAt),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });
  if (method === "HEAD") res.end(); else res.end(e.body);
}

function handleJunkPropfind(res: ServerResponse, urlPath: string, name: string, href: string) {
  const e = junkGet(urlPath);
  if (e) {
    const xml = multistatus([{
      href, displayName: name, isCollection: false,
      size: e.body.length, contentType: e.contentType,
      lastModified: e.modifiedAt, created: e.modifiedAt,
    }]);
    res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"', "DAV": "1, 2" });
    res.end(xml);
    return;
  }
  if (junkCollectionHas(urlPath)) {
    const xml = multistatus([{
      href: href.endsWith("/") ? href : href + "/",
      displayName: name, isCollection: true,
    }]);
    res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"', "DAV": "1, 2" });
    res.end(xml);
    return;
  }
  res.writeHead(404).end();
}

async function rescueAbortedSave(
  urlPath: string,
  segments: string[],
  user: User,
): Promise<void> {
  const lastSeg = segments[segments.length - 1] ?? "";
  const sbMatch = SB_TEMP_RE.exec(lastSeg);
  if (!sbMatch || !junkCollectionHas(urlPath)) return;
  const realName = lastSeg.slice(0, sbMatch.index);
  const innerKey = junkKey(urlPath) + "/" + realName;
  const stashed = junkStore.get(innerKey);
  if (!stashed || stashed.expiresAt <= Date.now()) return;
  const parentSegments = segments.slice(0, -1);
  const realUrlPath = "/" + [...parentSegments, realName].map(encodeSegment).join("/");
  const realResolved = await resolvePath([...parentSegments, realName], user);
  try {
    await commitRescuedBody(realResolved, stashed.entry.body, realName, user);
    console.log(`[webdav] räddade aborterad save: ${realUrlPath} (${stashed.entry.body.length} B)`);
  } catch (err) {
    console.error(`[webdav] kunde inte rädda aborterad save ${realUrlPath}:`, err);
  }
}

async function commitRescuedBody(
  resolved: Resolved,
  body: Buffer,
  realName: string,
  user: User,
): Promise<void> {
  if (resolved.kind === "document") {
    const d = resolved.document;
    const absPath = path.isAbsolute(d.storagePath)
      ? d.storagePath : path.resolve(process.cwd(), d.storagePath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, body);
    await prisma.document.update({
      where: { id: d.id },
      data: { fileSize: body.length, version: d.version + 1 },
    });
    triggerAnalysis(d.id);
  } else if (resolved.kind === "missing-in-folder") {
    await createNewDocument(resolved, body, realName, user);
  }
}

async function createNewDocument(
  resolved: Extract<Resolved, { kind: "missing-in-folder" }>,
  body: Buffer,
  fileName: string,
  user: User,
): Promise<void> {
  const mime = mimeFromExt(fileName);
  const docId = crypto.randomUUID();
  const dir = path.join(STORAGE_ROOT, resolved.matter.id, docId);
  const absPath = path.join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(absPath, body);
  const created = await prisma.document.create({
    data: {
      fileName, mimeType: mime, fileSize: body.length,
      storagePath: path.relative(process.cwd(), absPath),
      version: 1,
      matterId: resolved.matter.id,
      folderId: resolved.folder?.id ?? null,
      uploadedById: user.id,
    },
  });
  triggerAnalysis(created.id);
}

async function handleJunkDelete(res: ServerResponse, urlPath: string, user: User) {
  const segments = splitPath(urlPath);
  await rescueAbortedSave(urlPath, segments, user);
  junkDelete(urlPath);
  res.writeHead(204).end();
}

async function handleJunkMove(req: IncomingMessage, res: ServerResponse, urlPath: string, user: User) {
  const destHeader = (req.headers["destination"] as string | undefined) ?? "";
  const overwrite = ((req.headers["overwrite"] as string | undefined) ?? "T").toUpperCase() !== "F";
  if (!destHeader) { res.writeHead(400).end(); return; }
  let destPath: string;
  try { destPath = new URL(destHeader, "http://x").pathname; }
  catch { res.writeHead(400).end(); return; }

  const source = junkGet(urlPath);
  if (!source) { res.writeHead(404).end(); return; }

  const destResolved = await resolvePath(splitPath(destPath), user);

  if (destResolved.kind === "document") {
    if (!overwrite) { res.writeHead(412).end(); return; }
    await commitRescuedBody(destResolved, source.body, "", user);
    junkDelete(urlPath);
    res.writeHead(204).end();
    return;
  }

  if (destResolved.kind === "missing-in-folder") {
    await createNewDocument(destResolved, source.body, destResolved.name, user);
    junkDelete(urlPath);
    res.writeHead(201).end();
    return;
  }

  if (isJunkPath(destPath)) {
    junkSet(destPath, source);
    junkDelete(urlPath);
    res.writeHead(201).end();
    return;
  }

  res.writeHead(409).end();
}

function handleJunkProppatch(res: ServerResponse, href: string) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;
  res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
  res.end(xml);
}

async function handleJunkFile(
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  user: User,
): Promise<boolean> {
  const segments = splitPath(urlPath);
  const name = segments[segments.length - 1] ?? "";
  const href = urlPath;

  switch (method) {
    case "PUT": await handleJunkPut(req, res, urlPath, name); return true;
    case "GET":
    case "HEAD": handleJunkGet(res, urlPath, method); return true;
    case "PROPFIND": handleJunkPropfind(res, urlPath, name, href); return true;
    case "DELETE": await handleJunkDelete(res, urlPath, user); return true;
    case "MKCOL": junkCollectionAdd(urlPath); res.writeHead(201).end(); return true;
    case "MOVE": await handleJunkMove(req, res, urlPath, user); return true;
    case "COPY": res.writeHead(501).end(); return true;
    case "LOCK": handleLOCK(req, res); return true;
    case "UNLOCK": handleUNLOCK(req, res); return true;
    case "PROPPATCH": handleJunkProppatch(res, href); return true;
    default: return false;
  }
}

// ────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const method = (req.method ?? "").toUpperCase();
  const started = Date.now();

  // Log request → response with timing for debugging. Also append to a
  // file so we can inspect the exact sequence when a client misbehaves.
  const range = req.headers["range"] ? ` range=${req.headers["range"]}` : "";
  const depth = req.headers["depth"] ? ` depth=${req.headers["depth"]}` : "";
  res.on("finish", () => {
    const ms = Date.now() - started;
    const ua = (req.headers["user-agent"] ?? "").toString().slice(0, 60);
    const line = `${new Date().toISOString()} [${method}] ${res.statusCode} ${req.url}${range}${depth}  (${ms}ms)  ${ua}\n`;
    process.stdout.write(line);
    try { appendFileSync("/tmp/ava-webdav.log", line); } catch { /* ignore */ }
  });

  // OPTIONS — unauthenticated, so Finder can discover capabilities
  if (method === "OPTIONS") return handleOPTIONS(req, res);

  try {
    const user = await authenticate(req);
    if (!user) return requireAuth(res);

    // Intercept OS metadata-sidecar files so they don't pollute the DB.
    // We keep a small in-memory mirror so the OS can read back what it
    // wrote within a session, but nothing hits Prisma or disk.
    {
      const urlPath = new URL(req.url!, "http://x").pathname;
      if (isJunkPath(urlPath)) {
        const junked = await handleJunkFile(method, req, res, urlPath, user);
        if (junked) return;
      }
    }

    switch (method) {
      case "PROPFIND":  return await handlePROPFIND(req, res, user);
      case "GET":       return await handleGET(req, res, user, "GET");
      case "HEAD":      return await handleGET(req, res, user, "HEAD");
      case "PUT":       return await handlePUT(req, res, user);
      case "DELETE":    return await handleDELETE(req, res, user);
      case "MKCOL":     return await handleMKCOL(req, res, user);
      case "LOCK":      return handleLOCK(req, res);
      case "UNLOCK":    return handleUNLOCK(req, res);
      case "PROPPATCH": {
        // Finder sends PROPPATCH to set metadata (e.g. Finder flags).
        // Accept silently — we don't persist xattrs, but returning 405
        // makes Finder think the write failed and drops the file.
        const urlPath = new URL(req.url!, "http://x").pathname;
        const hrefEnc = urlPath;
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${hrefEnc}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
        res.end(xml);
        return;
      }
      case "MOVE":      return await handleMOVE(req, res, user);
      case "COPY": {
        // Not implemented — but respond 501 rather than 405 so Finder
        // doesn't think the whole resource is gone.
        res.writeHead(501).end();
        return;
      }
      default:
        res.writeHead(405, { "Allow": "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, LOCK, UNLOCK" });
        res.end();
    }
  } catch (err) {
    console.error(`[${method} ${req.url}]`, err);
    res.writeHead(500).end("Internal Server Error");
  }
});

// Starta bara HTTP-servern när modulen körs som entry-point. I tester sätter
// vi WEBDAV_SKIP_LISTEN=1 och attachar vår egen listener på en slumpvald port.
if (process.env.WEBDAV_SKIP_LISTEN !== "1") {
  server.listen(PORT, () => {
    console.log(`\n🗂️  AVA WebDAV server listening on http://localhost:${PORT}/`);
    console.log(`   Storage root: ${STORAGE_ROOT}`);
    console.log(`   Mount from Finder:  Cmd+K → http://localhost:${PORT}/`);
    console.log(`   Mount from Windows: Explorer → Map network drive → http://localhost:${PORT}/\n`);
  });
}

// Exporteras för integrationstester.
export { server, prisma };
