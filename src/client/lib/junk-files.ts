/**
 * Filenames that are OS metadata sidecars — never persist these as real
 * documents. Shared between the browser-upload route and the WebDAV server
 * (defense-in-depth so junk can't slip in through either path).
 */

const SB_TEMP_RE = /\.sb-[0-9a-f]{8}-[A-Za-z0-9]{6}$/;

const JUNK_EXACT = new Set([
  ".DS_Store",
  ".localized",
  ".hidden",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".TemporaryItems",
  ".apdisk",
  ".metadata_never_index",
  ".metadata_never_index_unless_rootfs",
  ".metadata_direct_scope_only",
  "Thumbs.db",
  "desktop.ini",
]);

export function isJunkFileName(name: string): boolean {
  if (!name) return true;
  if (name.startsWith("._")) return true; // AppleDouble
  if (SB_TEMP_RE.test(name)) return true; // macOS atomic-save temp
  return JUNK_EXACT.has(name);
}
