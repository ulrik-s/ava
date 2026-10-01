/**
 * Hostens enheter för backup på begäran (#1431). Säkerheten står i filerna:
 * `.path`-enheten startar en FAST enhet, och den enheten kör bara
 * `systemctl start ava-backup.service` — och inte alls om en export skrevs
 * de senaste fem minuterna. Spärren körs här på riktigt mot en katalog.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";

const read = (unit: string): string => readFileSync(join(process.cwd(), "tooling/systemd", unit), "utf8");
const directives = (text: string, key: string): string[] =>
  text.split("\n").filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1));

describe("ava-backup-request.path", () => {
  const unit = read("ava-backup-request.path");

  it("bevakar bara begärandekatalogen och startar bara begärandetjänsten", () => {
    expect(directives(unit, "PathChanged")).toEqual(["/srv/ava/backup-requests"]);
    expect(directives(unit, "Unit")).toEqual(["ava-backup-request.service"]);
    expect(directives(unit, "DirectoryMode")).toEqual(["0700"]);
    expect(directives(unit, "WantedBy")).toEqual(["multi-user.target"]);
  });
});

describe("ava-backup-request.service", () => {
  const unit = read("ava-backup-request.service");

  it("kör bara nattjobbets tjänst — inget ur begärandefilen", () => {
    expect(directives(unit, "ExecStart")).toEqual(["/bin/systemctl start --no-block ava-backup.service"]);
    expect(unit).not.toContain("backup-requests");
    expect(directives(unit, "Type")).toEqual(["oneshot"]);
  });

  describe("spärren (ExecCondition)", () => {
    let dir = "";
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-units-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    /** Villkoret som systemd kör (`$$` → `$`), mot `dir` i stället för exportkatalogen. */
    function condition(): number {
      const [line] = directives(unit, "ExecCondition");
      const cmd = (line ?? "").replace(/^\/bin\/sh -c '/, "").replace(/'$/, "").replaceAll("$$", "$").replaceAll("/srv/backup-chroot/ava", dir);
      return spawnSync("sh", ["-c", cmd]).status ?? -1;
    }

    it("ingen export: körs", () => {
      expect(condition()).toBe(0);
    });

    it("en export de senaste fem minuterna: körs inte", () => {
      writeFileSync(join(dir, "ava-2026-10-01-0300.tar.age"), "x");
      expect(condition()).not.toBe(0);
    });

    it("bara äldre exporter (och andra filer): körs", () => {
      const old = join(dir, "ava-2026-09-30-0300.tar.age");
      writeFileSync(old, "x");
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
      utimesSync(old, tenMinutesAgo, tenMinutesAgo);
      writeFileSync(join(dir, "annat.txt"), "x");
      expect(condition()).toBe(0);
    });
  });
});
