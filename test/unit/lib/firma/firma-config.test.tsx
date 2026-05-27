/**
 * Tester för `firma-config` — localStorage-baserad config för
 * vilken repo+token AVA pekar mot (Tier 1/2/3).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFirmaConfig, saveFirmaConfig, resetToDemo, inferTier,
  defaultConfigForHost, gitAuthUsername,
  type FirmaConfig,
} from "@/lib/client/firma/firma-config";

const KEY = "ava.firma";

describe("firma-config", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("defaultConfigForHost", () => {
    it("localhost → self-hosted mot docker:8080", () => {
      const cfg = defaultConfigForHost("localhost");
      expect(cfg.tier).toBe("self-hosted");
      expect(cfg.repo).toBe("http://localhost:8080/git/firma.git");
    });

    it("127.0.0.1 → samma self-hosted-default", () => {
      expect(defaultConfigForHost("127.0.0.1").tier).toBe("self-hosted");
    });

    it("publik domän → demo (gh-pages)", () => {
      const cfg = defaultConfigForHost("ulrik-s.github.io");
      expect(cfg.tier).toBe("demo");
      expect(cfg.repo).toBe("ulrik-s/ava-demo");
    });

    it("undefined hostname → demo", () => {
      expect(defaultConfigForHost(undefined).tier).toBe("demo");
    });
  });

  describe("loadFirmaConfig", () => {
    it("jsdom (localhost) → self-hosted-default när inget är sparat", () => {
      // jsdom rapporterar window.location.hostname === "localhost"
      const cfg = loadFirmaConfig();
      expect(cfg.tier).toBe("self-hosted");
      expect(cfg.repo).toBe("http://localhost:8080/git/firma.git");
      expect(cfg.organizationId).toBe("firma-ab");
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

    it("faller tillbaka till host-default-repo om sparad config saknar repo", () => {
      localStorage.setItem(KEY, JSON.stringify({ tier: "github", repo: "" }));
      const cfg = loadFirmaConfig();
      // jsdom = localhost → self-hosted-default
      expect(cfg.repo).toBe("http://localhost:8080/git/firma.git");
    });

    it("ignorerar korrupt JSON och returnerar host-default", () => {
      localStorage.setItem(KEY, "{kaos");
      const cfg = loadFirmaConfig();
      expect(cfg.tier).toBe("self-hosted");
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

  describe("gitAuthUsername", () => {
    it("github/demo → x-access-token (GitHub-konvention)", () => {
      expect(gitAuthUsername({ tier: "github", authorEmail: "a@b.se" })).toBe("x-access-token");
      expect(gitAuthUsername({ tier: "demo", authorEmail: "a@b.se" })).toBe("x-access-token");
    });
    it("self-hosted → explicit gitUsername (t.ex. admin) vinner", () => {
      expect(gitAuthUsername({ tier: "self-hosted", gitUsername: "admin", authorEmail: "a@b.se" })).toBe("admin");
    });
    it("self-hosted utan gitUsername → authorEmail (add-user.sh lägger till på e-post)", () => {
      expect(gitAuthUsername({ tier: "self-hosted", authorEmail: "anna@firma.se" })).toBe("anna@firma.se");
    });
    it("self-hosted utan något → x-access-token (sista fallback)", () => {
      expect(gitAuthUsername({ tier: "self-hosted", authorEmail: "" })).toBe("x-access-token");
    });
  });
});
