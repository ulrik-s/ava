/**
 * AVA Helper UI (ADR 0029/0030) — Electron menyrads-skal runt helper-motorn.
 *
 * Tray-only (inget fönster): startar motorn IN-PROCESS (`startEngine`, samma
 * Node-process — ingen medföljande binär/child-process längre, ADR 0030),
 * pollar dess /status och visar synk-läget i menyraden, samt en meny för
 * Logga in (loopback-PKCE, in-process), Sök uppdatering och Avsluta. All
 * icke-Electron-logik ligger i de testade modulerna; den här filen är tunt
 * Electron-lim.
 *
 * Verifieras genom att köras (`bun run dev`) / paketeras (`bun run dist`) på
 * mål-datorn — den interaktiva tray-/login-delen kan inte headless-testas.
 */

import { join } from "node:path";

import { app, dialog, Menu, shell, Tray, nativeImage } from "electron";

import { runLogin } from "./engine/auth/login.ts";
import { resolveLoginConfig, startEngine, type EngineHandle } from "./engine/main.ts";
import type { UpdateNotice } from "./engine/update.ts";
import { pollHelper } from "./status-poller.ts";
import { trayView } from "./tray-status.ts";

const POLL_INTERVAL_MS = 4_000;

/**
 * Kör inloggnings-flödet (loopback-PKCE) IN-PROCESS och YTLÄGGER fel i en dialog
 * — login får aldrig misslyckas tyst. Motorn läser config ur env ELLER
 * helper-config.json, så en Finder-startad app (utan shell-env) fungerar.
 */
async function startLogin(): Promise<void> {
  const cfg = resolveLoginConfig();
  if (!cfg) {
    dialog.showErrorBox(
      "AVA Helper — inloggning",
      "Ingen server konfigurerad ännu. Öppna AVA i webbläsaren så konfigureras " +
        "helpern automatiskt, och försök sedan igen.",
    );
    return;
  }
  try {
    await runLogin(cfg);
  } catch (err) {
    dialog.showErrorBox(
      "AVA Helper — inloggning",
      err instanceof Error ? err.message : String(err),
    );
  }
}

interface MenuActions {
  onCheckUpdate: () => void;
  onQuit: () => void;
}

/**
 * Bygg tray-menyn. Finns en uppdaterings-notis läggs en "ladda ner"-post överst
 * (ADR 0030 §2): osignerat bygge → manuell installation, så vi öppnar bara
 * release-sidan i webbläsaren.
 */
function buildMenu(tooltip: string, notice: UpdateNotice | null, actions: MenuActions): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: tooltip, enabled: false },
    { type: "separator" },
  ];
  if (notice) {
    items.push({
      label: `Ny version finns (${notice.version}) — ladda ner`,
      click: () => { void shell.openExternal(notice.url); },
    });
  }
  items.push(
    { label: "Logga in…", click: () => { void startLogin(); } },
    { label: "Sök efter uppdatering", click: actions.onCheckUpdate },
    { type: "separator" },
    { label: "Avsluta AVA Helper", click: actions.onQuit },
  );
  return Menu.buildFromTemplate(items);
}

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(__dirname, "..", "assets", "trayTemplate.png"));
  img.setTemplateImage(true); // macOS recolor:ar efter menyradens tema
  return img;
}

app.whenReady().then(() => {
  app.dock?.hide(); // tray-only, ingen dock-ikon
  const engine: EngineHandle = startEngine();

  const tray = new Tray(trayImage());
  const quit = (): void => { engine.stop(); app.quit(); };

  const refresh = async (): Promise<void> => {
    const snap = await pollHelper();
    const view = trayView(snap.present, snap.status);
    tray.setTitle(view.title ? ` ${view.title}` : "");
    tray.setToolTip(view.tooltip);
    tray.setContextMenu(buildMenu(view.tooltip, engine.updateNotice(), {
      // Motorn körs in-process → kolla direkt (ingen HTTP-rundtur) och rita om.
      onCheckUpdate: () => { void engine.checkForUpdate().then(refresh); },
      onQuit: quit,
    }));
  };
  void refresh();
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  app.on("before-quit", () => { clearInterval(timer); engine.stop(); });
}).catch((err: unknown) => {
  process.stderr.write(`helper-ui start misslyckades: ${err instanceof Error ? err.message : String(err)}\n`);
});

// Tray-app: stäng inte ner när (icke-existerande) fönster stängs.
app.on("window-all-closed", () => { /* behåll i menyraden */ });
