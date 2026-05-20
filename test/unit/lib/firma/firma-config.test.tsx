/**
 * Tester för `firma-config` — localStorage-baserad config för
 * vilken repo+token AVA pekar mot (Tier 1/2/3).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFirmaConfig, saveFirmaConfig, resetToDemo, inferTier,
  type FirmaConfig,
} from "@/lib/firma/firma-config";

const KEY = "ava.firma";

describe("firma-config", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadFirmaConfig", () => {
    it("returnerar demo-default när inget är sparat", () => {
      const cfg = loadFirmaConfig();
      expect(cfg.tier).toBe("demo");
      expect(cfg.repo).toBe("ulrik-s/ava-demo");
      expect(cfg.organizationId).toBe("demo-firma-ab");
    });

    it("returnerar sparad config", () => {
      const cfg: FirmaConfig = {
        tier: "github",
        repo: "firma/data",
        token: "ghp_x",
        organizationId: "firma",
        authorName: "Anna",
        authorEmail: "anna@firma.se",
      };
      localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(loadFirmaConfig()).toEqual(cfg);
    });

    it("faller tillbaka till demo-repo om sparad config saknar repo", () => {
      localStorage.setItem(KEY, JSON.stringify({ tier: "github", repo: "" }));
      const cfg = loadFirmaConfig();
      expect(cfg.repo).toBe("ulrik-s/ava-demo");
    });

    it("ignorerar korrupt JSON och returnerar default", () => {
      localStorage.setItem(KEY, "{kaos");
      const cfg = loadFirmaConfig();
      expect(cfg.tier).toBe("demo");
    });
  });

  describe("saveFirmaConfig + resetToDemo", () => {
    it("persistar till localStorage", () => {
      const cfg: FirmaConfig = {
        tier: "self-hosted", repo: "https://firma.se/git/data",
        token: "tk", organizationId: "f1",
        authorName: "A", authorEmail: "a@b.se",
      };
      saveFirmaConfig(cfg);
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(cfg);
    });

    it("resetToDemo tar bort nyckeln", () => {
      localStorage.setItem(KEY, "{}");
      resetToDemo();
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe("inferTier", () => {
    it("github.com-URL → github", () => {
      expect(inferTier("https://github.com/user/repo.git")).toBe("github");
    });
    it("kortform user/repo → github", () => {
      expect(inferTier("ulrik-s/ava-demo")).toBe("github");
    });
    it("HTTPS-URL utan github → self-hosted", () => {
      expect(inferTier("https://git.firma.se/data.git")).toBe("self-hosted");
    });
    it("tom sträng → demo", () => {
      expect(inferTier("")).toBe("demo");
    });
  });
});
