import { describe, expect, test } from "bun:test";

import { assetName, pickLatest } from "../src/update.ts";

interface Rel {
  tag_name: string;
  draft: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function rel(tag: string, draft = false): Rel {
  return { tag_name: tag, draft, assets: [] };
}

describe("assetName", () => {
  test("os/arch-format utan ext på unix", () => {
    expect(assetName("darwin", "arm64")).toBe("ava-helper-darwin-arm64");
    expect(assetName("linux", "x64")).toBe("ava-helper-linux-x64");
  });
  test(".exe på windows", () => {
    expect(assetName("windows", "x64")).toBe("ava-helper-windows-x64.exe");
  });
});

describe("pickLatest", () => {
  test("väljer nyaste icke-draft som matchar filter + är nyare", () => {
    const releases = [
      rel("helper-v1.0.0"),
      rel("helper-v1.3.0"),
      rel("helper-v1.2.0"),
    ];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.3.0");
  });

  test("hoppar över drafts", () => {
    const releases = [rel("helper-v2.0.0", true), rel("helper-v1.1.0")];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.1.0");
  });

  test("filtrerar bort taggar utan prefix (web-app-releaser)", () => {
    const releases = [rel("web-v9.0.0"), rel("helper-v1.1.0")];
    expect(pickLatest(releases, "helper-", "helper-v1.0.0")?.tag_name).toBe("helper-v1.1.0");
  });

  test("null när inget är nyare", () => {
    expect(pickLatest([rel("helper-v1.0.0")], "helper-", "helper-v1.2.0")).toBeNull();
  });
});
