/**
 * Sökvägen till dokumentets innehåll (#1372): form och ägarskap.
 */
import { describe, expect, it } from "vitest-compat";
import { contentStoragePath } from "@/lib/shared/content-address";
import {
  documentStoragePathSchema, foreignStoragePath, isDocumentStoragePath, isOwnStoragePath, type DocumentStoragePath,
} from "@/lib/shared/document-storage-path";

const ID = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const path = (p: string): DocumentStoragePath => documentStoragePathSchema.parse(p);

describe("form", () => {
  it.each([
    contentStoragePath("a".repeat(64)),
    `documents/content/pending-${ID}`,
    `documents/content/${ID}.pdf`,
    "documents/content/doc-pdf-01.pdf",
    "documents/content/placeholder",
  ])("%s har rätt form", (p) => {
    expect(isDocumentStoragePath(p)).toBe(true);
    expect(documentStoragePathSchema.safeParse(p).success).toBe(true);
  });

  it.each([
    ".git/index", "documents/content/../.git/index", "../x", "/documents/content/x", "documents/content/.git",
    "documents/content/sub/x", "documents/content/a.tar.gz", "documents/content/", "documents/x", "",
    `documents/content/${"a".repeat(200)}`,
  ])("%j har fel form", (p) => {
    expect(isDocumentStoragePath(p)).toBe(false);
    expect(documentStoragePathSchema.safeParse(p).success).toBe(false);
  });

  it("annat än en sträng har fel form", () => {
    expect(isDocumentStoragePath(42)).toBe(false);
    expect(isDocumentStoragePath(null)).toBe(false);
  });
});

describe("dokumentets eget innehåll", () => {
  it("innehållsadresserad, <id>, pending-<id> och <id>.<ext> är egna", () => {
    for (const p of [contentStoragePath("0".repeat(64)), `documents/content/${ID}`, `documents/content/pending-${ID}`, `documents/content/${ID}.html`]) {
      expect(isOwnStoragePath(path(p), ID)).toBe(true);
      expect(foreignStoragePath(path(p), ID)).toBeUndefined();
    }
  });

  it("ett annat dokuments fil, seedens namn och en hash i versaler är inte egna", () => {
    for (const p of ["documents/content/0199a1b2-0000-7000-8000-000000000000.pdf", "documents/content/doc-pdf-01.pdf", contentStoragePath("A".repeat(64))]) {
      expect(isOwnStoragePath(path(p), ID)).toBe(false);
      expect(foreignStoragePath(path(p), ID)).toBe(p);
    }
  });
});
