/**
 * AVA Helper UI (ADR 0029/0030) — Electron menyrads-skal runt helper-motorn.
 *
 * Startar motorn IN-PROCESS (`startEngine`, samma Node-process — ingen
 * medföljande binär/child-process längre, ADR 0030), pollar dess /status och
 * visar synk-läget i menyraden, samt en meny för Logga in (loopback-PKCE,
 * in-process), Sök uppdatering och Avsluta.
 *
 * Statusfönstret (#1603) öppnas när appen startas eller öppnas igen — det
 * syns även när macOS döljer menyradsikonen. Medan det är öppet visas appen i
 * Dock med en vanlig appmeny; stängs det går appen tillbaka till bakgrunden. All
 * icke-Electron-logik ligger i de testade modulerna; den här filen är tunt
 * Electron-lim.
 *
 * Verifieras genom att köras (`bun run dev`) / paketeras (`bun run dist`) på
 * mål-datorn — den interaktiva tray-/login-delen kan inte headless-testas.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, dialog, Menu, shell, Tray, nativeImage } from "electron";

import { runLogin } from "./engine/auth/login.ts";
import { caTrustStatus, resolveLoginConfig, startEngine, trustLocalCa, type EngineHandle } from "./engine/main.ts";
import type { UpdateStatus } from "./engine/update.ts";
import { VERSION } from "./engine/version.ts";
import { INSTALL_SCRIPT, runInstaller } from "./installer.ts";
import { parseAction, statusPageHtml, type LoginState, type StatusAction, type StatusPageModel } from "./status-page.ts";
import { pollHelper } from "./status-poller.ts";
import { trayView, updateStatusLine, type TrayView } from "./tray-status.ts";

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
  onShowStatus: () => void;
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
function buildMenu(tooltip: string, update: UpdateStatus, actions: MenuActions): Menu {
  const notice = update.notice;
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
    { label: "Visa status…", click: actions.onShowStatus },
    { label: "Logga in…", click: () => { void startLogin(); } },
    ...(actions.needsCertificate
      ? [{ label: "Installera certifikat för Safari…", click: actions.onInstallCertificate }]
      : []),
    update.checking
      ? { label: "Söker efter uppdatering…", enabled: false }
      : { label: "Sök efter uppdatering", click: actions.onCheckUpdate },
    { label: updateStatusLine(VERSION, update), enabled: false },
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

/** Appmenyn medan statusfönstret är öppet (appen syns då i Dock). */
function appMenu(showStatus: () => void, checkUpdate: () => void, quit: () => void): Menu {
  return Menu.buildFromTemplate([
    {
      label: "AVA Helper",
      submenu: [
        { label: "Om AVA Helper", click: showStatus },
        { label: "Sök efter uppdatering", click: checkUpdate },
        { type: "separator" },
        { role: "hide", label: "Göm AVA Helper" },
        { type: "separator" },
        { label: "Avsluta AVA Helper", accelerator: "Command+Q", click: quit },
      ],
    },
    { label: "Fönster", submenu: [{ role: "close", label: "Stäng fönster" }, { role: "minimize", label: "Minimera" }] },
  ]);
}

/**
 * Statusfönstret: HTML utan JavaScript (status-page.ts), knappar som
 * `ava:`-länkar som fångas här. Ritas om bara när innehållet ändrats.
 */
class StatusWindow {
  private win?: BrowserWindow;
  private html = "";

  constructor(
    private readonly model: () => StatusPageModel,
    private readonly onAction: (action: StatusAction) => void,
  ) {}

  show(): void {
    if (this.win) { this.win.show(); this.win.focus(); return; }
    const win = new BrowserWindow({
      width: 440, height: 520, resizable: false, show: false, title: "AVA Helper",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    win.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      const action = parseAction(url);
      if (action) this.onAction(action);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.once("ready-to-show", () => { win.show(); });
    win.on("closed", () => { delete this.win; this.html = ""; app.dock?.hide(); });
    this.win = win;
    void app.dock?.show();
    void this.render();
  }

  /** Stäng fönstret — appen fortsätter i bakgrunden (window-all-closed avslutar inte). */
  close(): void {
    this.win?.close();
  }

  async render(): Promise<void> {
    if (!this.win) return;
    const html = statusPageHtml(this.model());
    if (html === this.html) return;
    this.html = html;
    await this.win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
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

  // Statusfönstrets läge: synk från senaste pollningen, inloggning läses när
  // fönstret visas / efter inloggning (nyckelringen — inte var 4:e sekund).
  let sync: TrayView = trayView(false, null);
  let login: LoginState = "not-configured";
  let installing = false;
  const readLogin = async (): Promise<void> => {
    login = !resolveLoginConfig() ? "not-configured" : (await engine.isLoggedIn()) ? "logged-in" : "logged-out";
  };
  const status = new StatusWindow(() => ({
    version: VERSION,
    update: engine.updateStatus(),
    sync,
    login,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    canInstall: INSTALL_SCRIPT !== null,
    installing,
  }), (action) => { void onAction(action); });
  const showStatus = (): void => { void readLogin().then(() => { status.show(); }); };

  // Motorn körs in-process → kolla direkt (ingen HTTP-rundtur); fönstret visar förloppet.
  const checkUpdate = (): void => {
    const pending = engine.checkForUpdate();
    showStatus();
    void refresh();
    void pending.then(refresh);
  };
  const install = (): void => {
    if (INSTALL_SCRIPT === null) return;
    installing = true;
    void status.render();
    runInstaller(INSTALL_SCRIPT, join(app.getPath("logs"), "install.log"));
  };
  const ACTION_HANDLERS: Record<StatusAction, () => void | Promise<void>> = {
    "check-update": checkUpdate,
    install,
    download: () => { const n = engine.updateStatus().notice; if (n) void shell.openExternal(n.url); },
    login: () => startLogin().then(readLogin).then(() => status.render()),
    "toggle-login-item": () => {
      app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin });
      return status.render();
    },
    close: () => { status.close(); },
    quit: () => { quit(); },
  };
  const onAction = async (action: StatusAction): Promise<void> => { await ACTION_HANDLERS[action](); };

  // En ny version visas en gång per version, även om ingen öppnar fönstret själv.
  let shownNotice: string | null = null;
  const announceUpdate = (): void => {
    const notice = engine.updateStatus().notice;
    if (!notice || notice.version === shownNotice) return;
    shownNotice = notice.version;
    showStatus();
  };

  const refresh = async (): Promise<void> => {
    const snap = await pollHelper();
    const view = trayView(snap.present, snap.status);
    sync = view;
    announceUpdate();
    void status.render();
    tray.setTitle(view.title ? ` ${view.title}` : "");
    tray.setToolTip(view.tooltip);
    tray.setContextMenu(buildMenu(view.tooltip, engine.updateStatus(), {
      onShowStatus: showStatus,
      onCheckUpdate: checkUpdate,
      onQuit: quit,
      needsCertificate,
      onInstallCertificate: () => { void installCertificate(false).then(recheckCertificate); },
    }));
  };
  Menu.setApplicationMenu(appMenu(showStatus, checkUpdate, quit));
  // Öppnas appen igen (Finder, Spotlight, Dock, en andra instans) → visa fönstret.
  app.on("activate", showStatus);
  app.on("second-instance", showStatus);
  // Vid manuell start syns fönstret direkt; vid start vid inloggning körs appen tyst.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) showStatus();

  void refresh();
  if (needsCertificate) void installCertificate(true).then(recheckCertificate);
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  app.on("before-quit", () => { clearInterval(timer); engine.stop(); });
}).catch((err: unknown) => {
  process.stderr.write(`helper-ui start misslyckades: ${err instanceof Error ? err.message : String(err)}\n`);
});

// Tray-app: stäng inte ner när (icke-existerande) fönster stängs.
app.on("window-all-closed", () => { /* behåll i menyraden */ });
