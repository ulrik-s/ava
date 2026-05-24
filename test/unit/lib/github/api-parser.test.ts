/**
 * Tester för parseRepoLocator.
 */

import { describe, it, expect } from "vitest";
import { parseRepoLocator } from "@/client/lib/github/api";

describe("parseRepoLocator", () => {
  it("kortform 'user/repo'", () => {
    expect(parseRepoLocator("ulrik-s/ava-demo")).toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });

  it("HTTPS-URL med .git", () => {
    expect(parseRepoLocator("https://github.com/ulrik-s/ava-demo.git"))
      .toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });

  it("HTTPS-URL utan .git", () => {
    expect(parseRepoLocator("https://github.com/ulrik-s/ava-demo"))
      .toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });

  it("SSH-URL", () => {
    expect(parseRepoLocator("git@github.com:ulrik-s/ava-demo.git"))
      .toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });

  it("null för icke-GitHub-URL", () => {
    expect(parseRepoLocator("https://git.firma.se/data.git")).toBeNull();
  });

  it("trim whitespace", () => {
    expect(parseRepoLocator("  ulrik-s/ava-demo  ")).toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });
});
