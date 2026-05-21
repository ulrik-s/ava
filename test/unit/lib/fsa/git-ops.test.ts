/**
 * Tester för `cloneRepo`-idempotensen — om en tidigare clone lämnade
 * en partiell .git/ med en origin-remote ska vi inte krascha utan
 * istället re-konfigurera + fetcha.
 */

import { describe, it, expect, vi } from "vitest";

const mockClone = vi.fn();
const mockSetConfig = vi.fn();
const mockFetch = vi.fn();
const mockCheckout = vi.fn();

vi.mock("isomorphic-git", () => ({
  clone: mockClone,
  setConfig: mockSetConfig,
  fetch: mockFetch,
  checkout: mockCheckout,
}));

vi.mock("isomorphic-git/http/web", () => ({
  default: { request: vi.fn() },
}));

import { cloneRepo } from "@/lib/fsa/git-ops";
import type { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";

const fsStub = {} as FsaIsoGitAdapter;

describe("cloneRepo — idempotens", () => {
  it("happy path: vanlig clone körs en gång, inget fallback", async () => {
    mockClone.mockReset().mockResolvedValue(undefined);
    mockSetConfig.mockReset();
    mockFetch.mockReset();
    mockCheckout.mockReset();

    await cloneRepo(fsStub, { url: "https://github.com/u/r.git", token: "ghp_x" });

    expect(mockClone).toHaveBeenCalledTimes(1);
    expect(mockSetConfig).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it("fallback: 'already exists' → setConfig + fetch + checkout(force)", async () => {
    mockClone.mockReset().mockRejectedValue(
      new Error("Failed to create remote at origin because it already exists."),
    );
    mockSetConfig.mockReset().mockResolvedValue(undefined);
    mockFetch.mockReset().mockResolvedValue(undefined);
    mockCheckout.mockReset().mockResolvedValue(undefined);

    await expect(
      cloneRepo(fsStub, { url: "https://github.com/u/r.git", token: "ghp_x" }),
    ).resolves.toBeUndefined();

    expect(mockClone).toHaveBeenCalledTimes(1);
    expect(mockSetConfig).toHaveBeenCalledWith(expect.objectContaining({
      path: "remote.origin.url",
      value: "https://github.com/u/r.git",
    }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCheckout).toHaveBeenCalledWith(expect.objectContaining({
      ref: "main",
      force: true,
    }));
  });

  it("andra clone-errors kastas vidare oförändrade", async () => {
    mockClone.mockReset().mockRejectedValue(new Error("Network unreachable"));
    mockSetConfig.mockReset();

    await expect(
      cloneRepo(fsStub, { url: "https://github.com/u/r.git" }),
    ).rejects.toThrow(/network unreachable/i);

    expect(mockSetConfig).not.toHaveBeenCalled();
  });
});
