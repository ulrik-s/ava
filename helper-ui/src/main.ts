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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, dialog, Menu, shell, Tray, nativeImage } from "electron";

import { runLogin } from "./engine/auth/login.ts";
import { caTrustStatus, resolveLoginConfig, startEngine, trustLocalCa, type EngineHandle } from "./engine/main.ts";
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

/**
 * Trust-on-first-use (#1149): en okänd https-webbplats vill använda helpern.
 * Bara användaren kan godkänna — webbplatsen själv kan inte ge sig tillgång.
 */
async function confirmOrigin(origin: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Tillåt", "Neka"],
    defaultId: 1,
    cancelId: 1,
    title: "AVA Helper",
    message: `${new URL(origin).host} vill använda AVA Helper`,
    detail:
      `Webbplatsen ${origin} vill öppna och spara dokument via AVA Helper på den här datorn.\n\n` +
      "Tillåt bara om det är din byrås AVA.",
  });
  return response === 0;
}

/**
 * Safari (#1149): webbappen når helpern bara över https://localhost med ett
 * certifikat macOS litar på. Installeras i användarens nyckelring — macOS
 * frågar själv efter lösenordet. `ask` = fråga först (vid start); menyvalet
 * installerar direkt.
 */
async function installCertificate(ask: boolean): Promise<void> {
  if (ask) {
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Installera", "Inte nu"],
      defaultId: 0,
      cancelId: 1,
      title: "AVA Helper",
      message: "Installera certifikat för Safari",
      detail:
        "För att AVA i Safari ska kunna öppna dokument via AVA Helper behöver datorn lita på " +
        "helperns lokala certifikat. Det gäller bara den här datorn (localhost).\n\n" +
        "macOS ber dig bekräfta med ditt lösenord.",
    });
    if (response !== 0) return;
  }
  const res = trustLocalCa();
  if (!res.ok && !res.skipped) {
    dialog.showErrorBox("AVA Helper", "Certifikatet installerades inte. Försök igen via menyn \"Installera certifikat för Safari…\".");
  }
}

interface MenuActions {
  onCheckUpdate: () => void;
  onQuit: () => void;
  /** Visa "Installera certifikat för Safari…" (certifikatet saknas). */
  needsCertificate: boolean;
  onInstallCertificate: () => void;
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
    ...(actions.needsCertificate
      ? [{ label: "Installera certifikat för Safari…", click: actions.onInstallCertificate }]
      : []),
    { label: "Sök efter uppdatering", click: actions.onCheckUpdate },
    {
      label: "Starta vid inloggning",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); },
    },
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

/**
 * Första starten slår på "Starta vid inloggning" — helpern måste köra för att
 * dokument ska gå att öppna från AVA. Stänger användaren av det respekteras
 * det (markören gör att vi inte slår på igen).
 */
function enableLoginItemOnFirstRun(): void {
  const marker = join(app.getPath("userData"), "login-item-initialized");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(marker, new Date().toISOString());
}

// En instans åt gången — två motorer skulle slåss om portarna.
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  enableLoginItemOnFirstRun();
  app.dock?.hide(); // tray-only, ingen dock-ikon
  const engine: EngineHandle = startEngine({ confirmOrigin });

  const tray = new Tray(trayImage());
  const quit = (): void => { engine.stop(); app.quit(); };

  // Kollas vid start och efter installation — inte vid varje menyomritning (var 4:e s).
  let needsCertificate = caTrustStatus() === "untrusted";
  const recheckCertificate = (): void => {
    needsCertificate = caTrustStatus() === "untrusted";
    void refresh();
  };

  const refresh = async (): Promise<void> => {
    const snap = await pollHelper();
    const view = trayView(snap.present, snap.status);
    tray.setTitle(view.title ? ` ${view.title}` : "");
    tray.setToolTip(view.tooltip);
    tray.setContextMenu(buildMenu(view.tooltip, engine.updateNotice(), {
      // Motorn körs in-process → kolla direkt (ingen HTTP-rundtur) och rita om.
      onCheckUpdate: () => { void engine.checkForUpdate().then(refresh); },
      onQuit: quit,
      needsCertificate,
      onInstallCertificate: () => { void installCertificate(false).then(recheckCertificate); },
    }));
  };
  void refresh();
  if (needsCertificate) void installCertificate(true).then(recheckCertificate);
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  app.on("before-quit", () => { clearInterval(timer); engine.stop(); });
}).catch((err: unknown) => {
  process.stderr.write(`helper-ui start misslyckades: ${err instanceof Error ? err.message : String(err)}\n`);
});

// Tray-app: stäng inte ner när (icke-existerande) fönster stängs.
app.on("window-all-closed", () => { /* behåll i menyraden */ });
