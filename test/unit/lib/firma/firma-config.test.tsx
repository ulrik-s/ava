/**
 * Tester för `firma-config` — localStorage-baserad config för
 * vilken repo+token AVA pekar mot (Tier 1/2/3).
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import {
  loadFirmaConfig, saveFirmaConfig, resetToDemo,
  defaultConfigForHost,
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
        tier: "self-hosted",
        repo: "https://firma.se/git/data",
        token: "tk",
        organizationId: "firma",
        authorName: "Anna",
        authorEmail: "anna@firma.se",
      };
      localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(loadFirmaConfig()).toEqual(cfg);
    });

    it("migrerar pensionerad tier=github → demo (#514)", () => {
      localStorage.setItem(KEY, JSON.stringify({ tier: "github", repo: "user/repo" }));
      expect(loadFirmaConfig().tier).toBe("demo");
    });

    it("faller tillbaka till host-default-repo om sparad config saknar repo", () => {
      localStorage.setItem(KEY, JSON.stringify({ tier: "self-hosted", repo: "" }));
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

});
