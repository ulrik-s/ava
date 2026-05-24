/**
 * Tester för tauri-bridge — wrapper kring @tauri-apps/api/core invoke().
 *
 * Mockar @tauri-apps/api/core dynamiskt och styr __TAURI_INTERNALS__-sentinel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
  vi.doMock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (_evt: string, _fn: unknown) => () => {}),
  }));
  vi.doMock("@tauri-apps/plugin-dialog", () => ({
    open: vi.fn(async () => "/picked/path"),
  }));
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function asTauri(): void {
  (globalThis as unknown as { window: Window }).window = {
    __TAURI_INTERNALS__: {},
  } as unknown as Window;
}

describe("isTauri", () => {
  it("false när window saknas", async () => {
    const { isTauri } = await import("@/client/lib/integrations/tauri-bridge");
    expect(isTauri()).toBe(false);
  });

  it("false när __TAURI_INTERNALS__ saknas", async () => {
    (globalThis as unknown as { window: Window }).window = {} as Window;
    const { isTauri } = await import("@/client/lib/integrations/tauri-bridge");
    expect(isTauri()).toBe(false);
  });

  it("true när __TAURI_INTERNALS__ finns", async () => {
    asTauri();
    const { isTauri } = await import("@/client/lib/integrations/tauri-bridge");
    expect(isTauri()).toBe(true);
  });
});

describe("invoke-guard (icke-Tauri)", () => {
  it("varje command kastar med tydligt felmeddelande utanför Tauri", async () => {
    const { gitStatus } = await import("@/client/lib/integrations/tauri-bridge");
    await expect(gitStatus("/repo")).rejects.toThrow(/Tauri-command 'git_status'.*icke-Tauri/);
  });
});

describe("commands (i Tauri-kontext)", () => {
  beforeEach(() => { asTauri(); });

  it("openInDefaultApp anropar invoke med rätt args", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { openInDefaultApp } = await import("@/client/lib/integrations/tauri-bridge");
    await openInDefaultApp("/path/to/file.pdf");
    expect(invokeMock).toHaveBeenCalledWith("open_in_default_app", { path: "/path/to/file.pdf" });
  });

  it("gitClone forwardar token-arg", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { gitClone } = await import("@/client/lib/integrations/tauri-bridge");
    await gitClone("https://gh.com/foo.git", "/local", "ghp_xyz");
    expect(invokeMock).toHaveBeenCalledWith("git_clone", {
      url: "https://gh.com/foo.git",
      targetDir: "/local",
      token: "ghp_xyz",
    });
  });

  it("gitStatus returnerar typed entries", async () => {
    const expected = [{ path: "a.json", status: "modified" as const }];
    invokeMock.mockResolvedValueOnce(expected);
    const { gitStatus } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await gitStatus("/repo")).toEqual(expected);
  });

  it("gitCommitChanges skickar author + message", async () => {
    invokeMock.mockResolvedValueOnce({ oid: "abc", message: "x" });
    const { gitCommitChanges } = await import("@/client/lib/integrations/tauri-bridge");
    await gitCommitChanges("/repo", "feat: x", "Anna <anna@firma.se>");
    expect(invokeMock).toHaveBeenCalledWith("git_commit_changes", {
      repoPath: "/repo",
      message: "feat: x",
      author: "Anna <anna@firma.se>",
    });
  });

  it("gitPush default-args (utan remote/branch)", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { gitPush } = await import("@/client/lib/integrations/tauri-bridge");
    await gitPush("/repo", "tok");
    expect(invokeMock).toHaveBeenCalledWith("git_push", {
      repoPath: "/repo",
      remote: undefined,
      branch: undefined,
      token: "tok",
    });
  });

  it("gitPull med options", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "fast-forward", newHead: "newsha" });
    const { gitPull } = await import("@/client/lib/integrations/tauri-bridge");
    const r = await gitPull("/r", "tok", { remote: "origin", branch: "main" });
    expect(r.kind).toBe("fast-forward");
    expect(invokeMock).toHaveBeenCalledWith("git_pull", {
      repoPath: "/r",
      remote: "origin",
      branch: "main",
      token: "tok",
    });
  });

  it("secretGet/Set/Delete forwardar", async () => {
    invokeMock.mockResolvedValueOnce("tok-from-keychain");
    const { secretGet, secretSet, secretDelete } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await secretGet("github-token")).toBe("tok-from-keychain");
    expect(invokeMock).toHaveBeenLastCalledWith("secret_get", { key: "github-token" });

    invokeMock.mockResolvedValueOnce(undefined);
    await secretSet("k", "v");
    expect(invokeMock).toHaveBeenLastCalledWith("secret_set", { key: "k", value: "v" });

    invokeMock.mockResolvedValueOnce(undefined);
    await secretDelete("k");
    expect(invokeMock).toHaveBeenLastCalledWith("secret_delete", { key: "k" });
  });

  it("watchRepoStart returnerar token, watchRepoStop förbrukar den", async () => {
    invokeMock.mockResolvedValueOnce(42);
    const { watchRepoStart, watchRepoStop } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await watchRepoStart("/r")).toBe(42);
    invokeMock.mockResolvedValueOnce(undefined);
    await watchRepoStop(42);
    expect(invokeMock).toHaveBeenLastCalledWith("watch_repo_stop", { token: 42 });
  });

  it("oauthStartDeviceFlow konverterar snake_case → camelCase", async () => {
    invokeMock.mockResolvedValueOnce({
      device_code: "DC123",
      user_code: "UC456",
      verification_uri: "https://github.com/login/device",
      interval: 5,
      expires_in: 900,
    });
    const { oauthStartDeviceFlow } = await import("@/client/lib/integrations/tauri-bridge");
    const r = await oauthStartDeviceFlow("repo,user");
    expect(r).toEqual({
      deviceCode: "DC123",
      userCode: "UC456",
      verificationUri: "https://github.com/login/device",
      interval: 5,
      expiresIn: 900,
    });
    expect(invokeMock).toHaveBeenCalledWith("oauth_start_device_flow", { scopes: "repo,user" });
  });

  it("oauthPollAccessToken — done konverterar access_token → accessToken", async () => {
    invokeMock.mockResolvedValueOnce({ status: "done", access_token: "ghp_done" });
    const { oauthPollAccessToken } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await oauthPollAccessToken("DC")).toEqual({ status: "done", accessToken: "ghp_done" });
  });

  it("oauthPollAccessToken — pending propagerar oförändrat", async () => {
    invokeMock.mockResolvedValueOnce({ status: "authorization_pending" });
    const { oauthPollAccessToken } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await oauthPollAccessToken("DC")).toEqual({ status: "authorization_pending" });
  });

  it("listConflictedFiles forwardar", async () => {
    const result = [{ path: "x.json", kind: "both_modified" as const }];
    invokeMock.mockResolvedValueOnce(result);
    const { listConflictedFiles } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await listConflictedFiles("/r")).toEqual(result);
  });
});

describe("non-invoke commands", () => {
  it("pickFolder returnerar null när inte i Tauri", async () => {
    const { pickFolder } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await pickFolder()).toBeNull();
  });

  it("pickFolder returnerar string i Tauri-kontext", async () => {
    asTauri();
    const { pickFolder } = await import("@/client/lib/integrations/tauri-bridge");
    expect(await pickFolder("Välj firma-mapp")).toBe("/picked/path");
  });

  it("onRepoChange returnerar no-op unsubscribe utanför Tauri", async () => {
    const { onRepoChange } = await import("@/client/lib/integrations/tauri-bridge");
    const unsub = await onRepoChange(() => {});
    expect(typeof unsub).toBe("function");
    expect(unsub()).toBeUndefined();
  });
});
