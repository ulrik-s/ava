/**
 * AVA Helper UI (ADR 0029) — Electron menyrads-skal runt Bun-helper-motorn.
 *
 * Tray-only (inget fönster): startar + övervakar motorn (EngineSupervisor),
 * pollar dess /status och visar synk-läget i menyraden, samt en meny för
 * Logga in (loopback-PKCE), Sök uppdatering och Avsluta. All icke-Electron-
 * logik ligger i de testade modulerna; den här filen är tunt Electron-lim.
 *
 * Verifieras genom att köras (`bun run dev`) / paketeras (`bun run dist`) på
 * mål-datorn — den interaktiva tray-/login-delen kan inte headless-testas.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

import { app, dialog, Menu, Tray, nativeImage } from "electron";

import { HELPER_BASE } from "@/lib/shared/helper/protocol";
import { EngineSupervisor, type SpawnedProcess } from "./engine.ts";
import { pollHelper } from "./status-poller.ts";
import { trayView } from "./tray-status.ts";

const POLL_INTERVAL_MS = 4_000;

/** Sökväg till den medföljande/byggda Bun-motorn. */
function resolveEnginePath(): string {
  if (process.env.AVA_HELPER_BIN) return process.env.AVA_HELPER_BIN;
  if (app.isPackaged) return join(process.resourcesPath, "ava-helper");
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return join(__dirname, "..", "..", "helper-app", "dist", `ava-helper-darwin-${arch}`);
}

/** node:child_process → EngineSupervisor.SpawnedProcess-adaptern. */
function spawnEngine(binPath: string, args: readonly string[]): SpawnedProcess {
  const child = spawn(binPath, [...args], { stdio: "ignore" });
  return {
    kill: () => { child.kill(); },
    onExit: (cb) => child.once("exit", cb),
  };
}

/**
 * Starta inloggnings-flödet (loopback-PKCE) som en transient motor-invokation.
 * Fångar stderr och YTLÄGGER fel i en dialog — login får aldrig misslyckas
 * tyst (motsatsen till KATS-HIIT). Motorn läser config ur env ELLER
 * helper-config.json, så en Finder-startad app (utan shell-env) fungerar.
 */
function startLogin(binPath: string): void {
  const child = spawn(binPath, ["--login"], { stdio: ["ignore", "ignore", "pipe"], env: process.env });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
  child.on("error", (e) => dialog.showErrorBox("AVA Helper — inloggning", `Kunde inte starta inloggningen: ${e.message}`));
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      dialog.showErrorBox("AVA Helper — inloggning", stderr.trim() || `Inloggningen avslutades (kod ${code}).`);
    }
  });
}

async function triggerUpdateCheck(): Promise<void> {
  try {
    await fetch(`${HELPER_BASE}/check-update`, { method: "POST", signal: AbortSignal.timeout(2_000) });
  } catch {
    /* motorn ej igång ännu — tyst */
  }
}

function buildMenu(binPath: string, tooltip: string, onQuit: () => void): Menu {
  return Menu.buildFromTemplate([
    { label: tooltip, enabled: false },
    { type: "separator" },
    { label: "Logga in…", click: () => startLogin(binPath) },
    { label: "Sök efter uppdatering", click: () => { void triggerUpdateCheck(); } },
    { type: "separator" },
    { label: "Avsluta AVA Helper", click: onQuit },
  ]);
}

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(__dirname, "..", "assets", "trayTemplate.png"));
  img.setTemplateImage(true); // macOS recolor:ar efter menyradens tema
  return img;
}

app.whenReady().then(() => {
  app.dock?.hide(); // tray-only, ingen dock-ikon
  const binPath = resolveEnginePath();
  const engine = new EngineSupervisor(binPath, [], {
    spawn: spawnEngine,
    now: () => Date.now(),
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  });
  engine.start();

  const tray = new Tray(trayImage());
  const quit = (): void => { engine.stop(); app.quit(); };

  const refresh = async (): Promise<void> => {
    const snap = await pollHelper();
    const view = trayView(snap.present, snap.status);
    tray.setTitle(view.title ? ` ${view.title}` : "");
    tray.setToolTip(view.tooltip);
    tray.setContextMenu(buildMenu(binPath, view.tooltip, quit));
  };
  void refresh();
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  app.on("before-quit", () => { clearInterval(timer); engine.stop(); });
}).catch((err: unknown) => {
  process.stderr.write(`helper-ui start misslyckades: ${err instanceof Error ? err.message : String(err)}\n`);
});

// Tray-app: stäng inte ner när (icke-existerande) fönster stängs.
app.on("window-all-closed", () => { /* behåll i menyraden */ });
