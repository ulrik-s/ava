/**
 * Tester för `github-auth` — detektering av auth-mode mot GitHub API.
 *
 * Tre lägen:
 *   1. anonymous       — ingen token eller token funkar inte
 *   2. identified-read  — token funkar, men inga push-rättigheter på repo
 *   3. identified-write — token funkar och kan pusha till repo
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectAuthMode,
  getCurrentUser,
  getRepoPermissions,
  parseRepoUrl,
  type AuthMode,
} from "@/client/lib/auth/github-auth";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
function fail(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response;
}

describe("parseRepoUrl", () => {
  it("ulrik-s/ava-demo → owner+repo", () => {
    expect(parseRepoUrl("ulrik-s/ava-demo")).toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });
  it("https://github.com/ulrik-s/ava-demo.git → owner+repo", () => {
    expect(parseRepoUrl("https://github.com/ulrik-s/ava-demo.git"))
      .toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });
  it("ssh-form git@github.com:user/repo.git → null (för github-auth-syften)", () => {
    expect(parseRepoUrl("git@github.com:ulrik-s/ava-demo.git"))
      .toEqual({ owner: "ulrik-s", repo: "ava-demo" });
  });
  it("self-hosted URL → null (inte GitHub)", () => {
    expect(parseRepoUrl("https://git.firma.se/data.git")).toBeNull();
  });
  it("tom sträng → null", () => {
    expect(parseRepoUrl("")).toBeNull();
  });
});

describe("getCurrentUser", () => {
  it("returnerar user vid 200", async () => {
    fetchMock.mockResolvedValueOnce(ok({ login: "anna", id: 123, name: "Anna" }));
    const u = await getCurrentUser("ghp_x");
    expect(u).toEqual({ login: "anna", id: 123, name: "Anna" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghp_x" }),
      }),
    );
  });
  it("returnerar null vid 401", async () => {
    fetchMock.mockResolvedValueOnce(fail(401));
    expect(await getCurrentUser("bad")).toBeNull();
  });
  it("returnerar null vid network-fel", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await getCurrentUser("x")).toBeNull();
  });
});

describe("getRepoPermissions", () => {
  it("returnerar permissions från 200-respons", async () => {
    fetchMock.mockResolvedValueOnce(ok({
      permissions: { admin: false, maintain: false, push: true, triage: false, pull: true },
    }));
    expect(await getRepoPermissions("tk", "ulrik-s", "ava-demo"))
      .toEqual({ canPush: true, canRead: true });
  });
  it("anonym 404 → null (kan vara privat och unauthenticated)", async () => {
    fetchMock.mockResolvedValueOnce(fail(404));
    expect(await getRepoPermissions("", "ulrik-s", "privat-repo")).toBeNull();
  });
  it("token utan repo-access → 404", async () => {
    fetchMock.mockResolvedValueOnce(fail(404));
    expect(await getRepoPermissions("ghp_x", "annan", "repo")).toBeNull();
  });
  it("publika repo utan push (200 utan permissions-fält)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ name: "publika" }));
    expect(await getRepoPermissions("", "ulrik-s", "publika"))
      .toEqual({ canRead: true, canPush: false });
  });
});

describe("detectAuthMode", () => {
  it("ingen token + publika repo → anonymous", async () => {
    fetchMock.mockResolvedValueOnce(ok({ name: "ava-demo" })); // GET repo
    const m: AuthMode = await detectAuthMode({ token: "", repoUrl: "ulrik-s/ava-demo" });
    expect(m).toBe("anonymous");
  });
  it("token + push → identified-write", async () => {
    fetchMock.mockResolvedValueOnce(ok({ login: "anna" })); // GET user
    fetchMock.mockResolvedValueOnce(ok({ permissions: { push: true } })); // GET repo
    const m = await detectAuthMode({ token: "ghp_x", repoUrl: "ulrik-s/ava-demo" });
    expect(m).toBe("identified-write");
  });
  it("token + ingen push → identified-read", async () => {
    fetchMock.mockResolvedValueOnce(ok({ login: "guest" }));
    fetchMock.mockResolvedValueOnce(ok({ permissions: { push: false } }));
    const m = await detectAuthMode({ token: "ghp_x", repoUrl: "ulrik-s/ava-demo" });
    expect(m).toBe("identified-read");
  });
  it("invalid token → anonymous (fallback)", async () => {
    fetchMock.mockResolvedValueOnce(fail(401));
    fetchMock.mockResolvedValueOnce(ok({ name: "ava-demo" }));
    const m = await detectAuthMode({ token: "bad", repoUrl: "ulrik-s/ava-demo" });
    expect(m).toBe("anonymous");
  });
  it("self-hosted repo + token → identified-write (kan inte detektera, anta push)", async () => {
    // För self-hosted vet vi inte permissions utan GitHub-API. Vi
    // litar på user:n när de explicit angett en token.
    const m = await detectAuthMode({ token: "tk", repoUrl: "https://git.firma.se/data.git" });
    expect(m).toBe("identified-write");
  });
  it("self-hosted utan token → anonymous", async () => {
    const m = await detectAuthMode({ token: "", repoUrl: "https://git.firma.se/data.git" });
    expect(m).toBe("anonymous");
  });
  it("lokal self-hosted (localhost) utan token → identified-write (anonym push tillåts)", async () => {
    const m = await detectAuthMode({ token: "", repoUrl: "http://localhost:8080/git/firma.git" });
    expect(m).toBe("identified-write");
  });
});
