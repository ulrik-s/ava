/**
 * Phase 4: "Bli X" — admin byter principal genom user-listan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { becomeUser } from "@/app/users/page";

describe("becomeUser", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "demo", repo: "ulrik-s/ava", token: "",
      organizationId: "<uuid-org>", authorName: "Anna", authorEmail: "a@ava",
      principalId: "<uuid-anna>",
    }));
  });

  it("uppdaterar principalId + authorName + authorEmail i firma-config", () => {
    vi.stubGlobal("location", { replace: vi.fn() } as unknown as Location);
    becomeUser({ id: "<uuid-bjorn>", name: "Björn Bauer", email: "bjorn@ava" });
    const cfg = JSON.parse(localStorage.getItem("ava.firma") ?? "{}");
    expect(cfg.principalId).toBe("<uuid-bjorn>");
    expect(cfg.authorName).toBe("Björn Bauer");
    expect(cfg.authorEmail).toBe("bjorn@ava");
  });

  it("redirectar till root så demo-bootstrap re-initierar med nytt principal", () => {
    const replace = vi.fn();
    vi.stubGlobal("location", { replace } as unknown as Location);
    becomeUser({ id: "x", name: "X", email: "x@ava" });
    expect(replace).toHaveBeenCalledWith("/");
  });
});
