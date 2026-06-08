/**
 * signOutLocally — sidebar:s "Logga ut"-knapp. Tidigare buggig:
 * rensade bara token, lämnade principalId kvar → reload kom till samma
 * sida → upplevdes som "knappen gjorde inget".
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { signOutLocally } from "@/components/shell/sidebar";

const STORAGE_KEY = "ava.firma";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("location", { replace: vi.fn() } as unknown as Location);
});

describe("signOutLocally", () => {
  it("rensar principalId från firma-config", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tier: "demo", repo: "x", token: "abc", organizationId: "org-1",
      principalId: "u-uuid", authorName: "Anna",
    }));
    signOutLocally();
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(cfg.principalId).toBeUndefined();
  });

  it("rensar token från firma-config", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tier: "demo", token: "secret", principalId: "u-1",
    }));
    signOutLocally();
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(cfg.token).toBeUndefined();
  });

  it("bevarar repo + organizationId + author-info", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tier: "demo", repo: "myrepo", organizationId: "org-1",
      authorName: "Anna", authorEmail: "a@x", principalId: "u-1", token: "t",
    }));
    signOutLocally();
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(cfg.repo).toBe("myrepo");
    expect(cfg.organizationId).toBe("org-1");
    expect(cfg.authorName).toBe("Anna");
  });

  it("navigerar till /login (med basePath)", () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { replace } as unknown as Location);
    signOutLocally();
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/\/login\/$/));
  });

  it("kraschar inte även om localStorage är trasig", () => {
    localStorage.setItem(STORAGE_KEY, "{ ogiltig json");
    expect(() => signOutLocally()).not.toThrow();
  });
});
