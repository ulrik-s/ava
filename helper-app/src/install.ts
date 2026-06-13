/**
 * Self-install (#86): `ava-helper --install` / `--uninstall`.
 *
 * BESLUT (#86): self-install — binären installerar SIG SJÄLV som en
 * användar-service (ingen sudo), i stället för separata .pkg/.msi/.deb. Ett
 * kommando på alla tre OS:
 *   1. kopierar binären till data-dir (`resolveDataDir`),
 *   2. skriver service-definitionen (launchd-plist / systemd-unit / Task
 *      Scheduler-XML) med ABSOLUT path till binären,
 *   3. registrerar + startar servicen (launchctl / systemctl --user / schtasks),
 *   4. installerar lokal-CA-trust på macOS (`--install-trust`, ADR 0006) så
 *      Safari/WKWebView litar på HTTPS-loopback (Office-add-ins #83).
 * Self-update (#78/#110) sköts sedan av den körande servicen.
 *
 * SIGNERING/NOTARISERING (Apple Developer ID / Windows-cert) är ett SEPARAT,
 * manuellt steg som kräver byråns/utgivarens certifikat — kan inte göras i
 * koden. Utan det varnar OS:et vid första körning. Se README + #87.
 *
 * Allt OS-anrop går via injicerade deps (SOLID) → testbart utan att faktiskt
 * röra maskinen (samma mönster som tls/trust.ts).
 */

import { join } from "node:path";
import { resolveDataDir, type DataDirEnv } from "./paths.ts";
import type { Platform } from "./platform/runtime.ts";

const LABEL = "se.ava.helper";

export interface InstallPaths {
  /** Var binären ska bo (kopieras hit från execPath). */
  binPath: string;
  /** Service-definitionens målfil (plist/unit/xml). */
  servicePath: string;
  /** Logg-katalog (macOS launchd skriver hit). */
  logDir: string;
}

/** Lös installations-paths per OS. `null` = ej stödd plattform / ingen home. */
export function resolveInstallPaths(platform: Platform, home: string, env: DataDirEnv = {}): InstallPaths | null {
  const dataDir = resolveDataDir(platform, home, env);
  if (dataDir === null) return null;
  const exe = platform === "windows" ? "ava-helper.exe" : "ava-helper";
  const binPath = join(dataDir, exe);
  switch (platform) {
    case "darwin":
      return { binPath, servicePath: join(home, "Library", "LaunchAgents", `${LABEL}.plist`), logDir: join(home, "Library", "Logs", "AVA") };
    case "linux":
      return { binPath, servicePath: join(home, ".config", "systemd", "user", "ava-helper.service"), logDir: join(dataDir, "logs") };
    case "windows":
      return { binPath, servicePath: join(dataDir, "ava-helper-task.xml"), logDir: join(dataDir, "logs") };
    default:
      return null;
  }
}

/** launchd-user-agent (KeepAlive → startar om efter self-update-exit). */
export function renderLaunchdPlist(binPath: string, logDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key><array><string>${binPath}</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${join(logDir, "launchd.out.log")}</string>
    <key>StandardErrorPath</key><string>${join(logDir, "launchd.err.log")}</string>
    <key>ThrottleInterval</key><integer>30</integer>
</dict>
</plist>
`;
}

/** systemd user-unit (Restart=always → startar om efter self-update-exit). */
export function renderSystemdUnit(binPath: string): string {
  return `[Unit]
Description=AVA Helper — lokala dokument-broker
After=network.target

[Service]
Type=simple
ExecStart=${binPath}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ava-helper

[Install]
WantedBy=default.target
`;
}

/** Windows Task Scheduler-XML (kör vid logon, startar om vid krasch). */
export function renderWindowsTaskXml(binPath: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Settings>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
  </Settings>
  <Actions><Exec><Command>${binPath}</Command></Exec></Actions>
</Task>
`;
}

/** Service-definitionens innehåll för plattformen. */
export function renderServiceFile(platform: Platform, paths: InstallPaths): string {
  switch (platform) {
    case "darwin":
      return renderLaunchdPlist(paths.binPath, paths.logDir);
    case "linux":
      return renderSystemdUnit(paths.binPath);
    case "windows":
      return renderWindowsTaskXml(paths.binPath);
    default:
      return "";
  }
}

/** Kommandon för att (av)registrera servicen — rena arg-byggare (testbara). */
export function registerArgs(platform: Platform, paths: InstallPaths): Array<{ cmd: string; args: string[] }> {
  switch (platform) {
    case "darwin":
      return [
        { cmd: "launchctl", args: ["unload", paths.servicePath] },
        { cmd: "launchctl", args: ["load", "-w", paths.servicePath] },
      ];
    case "linux":
      return [
        { cmd: "systemctl", args: ["--user", "daemon-reload"] },
        { cmd: "systemctl", args: ["--user", "enable", "--now", "ava-helper"] },
      ];
    case "windows":
      return [{ cmd: "schtasks", args: ["/Create", "/F", "/TN", "AVA Helper", "/XML", paths.servicePath] }];
    default:
      return [];
  }
}

export function unregisterArgs(platform: Platform, paths: InstallPaths): Array<{ cmd: string; args: string[] }> {
  switch (platform) {
    case "darwin":
      return [{ cmd: "launchctl", args: ["unload", "-w", paths.servicePath] }];
    case "linux":
      return [{ cmd: "systemctl", args: ["--user", "disable", "--now", "ava-helper"] }];
    case "windows":
      return [{ cmd: "schtasks", args: ["/Delete", "/F", "/TN", "AVA Helper"] }];
    default:
      return [];
  }
}

/** Injicerbara OS-/fs-beroenden (SOLID) — fakes i test, riktiga i main. */
export interface InstallDeps {
  mkdirp: (dir: string) => void;
  copyFile: (from: string, to: string) => void;
  chmodExec: (path: string) => void;
  writeFile: (path: string, content: string) => void;
  run: (cmd: string, args: string[]) => void;
  /** macOS CA-trust (no-op på andra OS). */
  installTrust: () => void;
  log: (msg: string) => void;
}

/**
 * Installera helpern som user-service. Ren orkestrering över injicerade deps:
 * kopiera binär → skriv service-fil → registrera → (macOS) trust.
 */
export function installService(platform: Platform, home: string, execPath: string, deps: InstallDeps, env: DataDirEnv = {}): boolean {
  const paths = resolveInstallPaths(platform, home, env);
  if (!paths) {
    deps.log(`self-install stöds inte på plattformen "${platform}"`);
    return false;
  }
  deps.mkdirp(dirOf(paths.binPath));
  deps.mkdirp(dirOf(paths.servicePath));
  deps.mkdirp(paths.logDir);
  if (execPath !== paths.binPath) {
    deps.copyFile(execPath, paths.binPath);
    deps.chmodExec(paths.binPath);
  }
  deps.writeFile(paths.servicePath, renderServiceFile(platform, paths));
  for (const { cmd, args } of registerArgs(platform, paths)) deps.run(cmd, args);
  if (platform === "darwin") deps.installTrust();
  deps.log(`ava-helper installerad som user-service (${paths.binPath})`);
  return true;
}

/** Avregistrera servicen (binären/data-dir lämnas kvar). */
export function uninstallService(platform: Platform, home: string, deps: InstallDeps, env: DataDirEnv = {}): boolean {
  const paths = resolveInstallPaths(platform, home, env);
  if (!paths) return false;
  for (const { cmd, args } of unregisterArgs(platform, paths)) deps.run(cmd, args);
  deps.log("ava-helper avregistrerad");
  return true;
}

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? path : path.slice(0, i);
}
