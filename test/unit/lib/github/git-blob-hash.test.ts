/**
 * Tester för gitBlobSha1 mot kända git-test-vectors.
 *
 * `git hash-object` på en tom fil ger e69de29bb2d1d6434b8b29ae775ad8c2e48c5391.
 * `git hash-object -t blob --stdin <<< "hello"` ger
 * b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0 (med trailing newline).
 */

import { describe, it, expect } from "vitest";
import { gitBlobSha1 } from "@/lib/client/github/git-blob-hash";

describe("gitBlobSha1", () => {
  it("tom byte-stream → standardvärde för tom blob", async () => {
    const sha = await gitBlobSha1(new Uint8Array(0));
    expect(sha).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("'hello\\n' (6 bytes) → känt git-blob-SHA", async () => {
    const sha = await gitBlobSha1(new TextEncoder().encode("hello\n"));
    // git hash-object med innehåll "hello\n"
    expect(sha).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("samma innehåll → samma SHA (determinism)", async () => {
    const a = await gitBlobSha1(new TextEncoder().encode("abc"));
    const b = await gitBlobSha1(new TextEncoder().encode("abc"));
    expect(a).toBe(b);
  });

  it("olika innehåll → olika SHA", async () => {
    const a = await gitBlobSha1(new TextEncoder().encode("apple"));
    const b = await gitBlobSha1(new TextEncoder().encode("banana"));
    expect(a).not.toBe(b);
  });

  it("returnerar 40 chars hex lowercase", async () => {
    const sha = await gitBlobSha1(new TextEncoder().encode("x"));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
