/**
 * Statusfönstret (#1603) — det juristen ser när AVA Helper öppnas: version,
 * uppdatering, synk och inloggning, med knappar för det man kan göra.
 * Fungerar oavsett om macOS visar menyradsikonen.
 *
 * Ren HTML-generering → testbar utan Electron. Fönstret kör utan JavaScript;
 * knapparna är länkar (`ava:<åtgärd>`) som skalet fångar i `will-navigate`.
 */

import type { UpdateStatus } from "./engine/update.ts";
import { checkedAt, type TrayView } from "./tray-status.ts";

export type LoginState = "not-configured" | "logged-out" | "logged-in";

export interface StatusPageModel {
  version: string;
  update: UpdateStatus;
  sync: TrayView;
  login: LoginState;
  openAtLogin: boolean;
  /** Installationsskriptet är inbakat → "Uppdatera nu" kan köras från appen. */
  canInstall: boolean;
  /** En uppdatering har startats — appen startar om strax. */
  installing: boolean;
}

const ACTIONS = ["check-update", "install", "download", "login", "toggle-login-item", "quit"] as const;
export type StatusAction = (typeof ACTIONS)[number];

/** `ava:check-update` → "check-update"; allt annat → null (navigeras aldrig). */
export function parseAction(url: string): StatusAction | null {
  const name = /^ava:([a-z-]+)$/.exec(url)?.[1];
  return ACTIONS.find((a) => a === name) ?? null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const button = (action: StatusAction, label: string, primary = false): string =>
  `<a class="btn${primary ? " primary" : ""}" href="ava:${action}">${esc(label)}</a>`;

function row(label: string, value: string, actions = ""): string {
  return `<div class="row"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>`
    + (actions ? `<div class="actions">${actions}</div>` : "") + "</div>";
}

/** Uppdateringsraden: text + vad man kan göra just nu. */
function updateRow(m: StatusPageModel, now: Date): string {
  const { update } = m;
  if (m.installing) return row("Uppdatering", "Uppdaterar… AVA Helper startar om strax.");
  if (update.checking) return row("Uppdatering", "Söker efter uppdatering…");
  const check = button("check-update", "Sök efter uppdatering");
  if (update.notice) {
    const get = m.canInstall ? button("install", "Uppdatera nu", true) : button("download", "Ladda ner", true);
    return row("Uppdatering", `Ny version finns: ${update.notice.version}`, get + check);
  }
  if (update.last === null) return row("Uppdatering", "Inte kontrollerad än", check);
  const text = update.last.result === "error" ? "Kunde inte söka — kontrollera nätverket" : "Du har senaste versionen";
  return row("Uppdatering", `${text} (${checkedAt(update.last.at, now)})`, check);
}

function syncText(sync: TrayView): string {
  if (sync.state === "synced") return "Allt synkat";
  if (sync.state === "absent") return "Inte igång";
  return sync.tooltip;
}

const LOGIN_TEXT: Record<LoginState, string> = {
  "logged-in": "Inloggad",
  "logged-out": "Inte inloggad",
  "not-configured": "Inte kopplad till AVA än — öppna AVA i webbläsaren",
};

function loginRow(login: LoginState): string {
  return row("Inloggning", LOGIN_TEXT[login], login === "logged-out" ? button("login", "Logga in…", true) : "");
}

function startRow(openAtLogin: boolean): string {
  return row("Starta vid inloggning", openAtLogin ? "Ja" : "Nej",
    button("toggle-login-item", openAtLogin ? "Stäng av" : "Slå på"));
}

const STYLE = `
:root { color-scheme: light dark; --bg:#f5f5f7; --card:#fff; --text:#1d1d1f; --muted:#6e6e73; --line:#e5e5ea; --accent:#0a66d8; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --card:#2c2c2e; --text:#f5f5f7; --muted:#a1a1a6; --line:#3a3a3c; --accent:#3d8bff; } }
* { box-sizing: border-box; }
body { margin:0; padding:20px; background:var(--bg); color:var(--text); font:13px -apple-system, system-ui, sans-serif; -webkit-user-select:none; cursor:default; }
h1 { font-size:17px; margin:0 0 2px; } .sub { color:var(--muted); margin:0 0 16px; }
.card { background:var(--card); border-radius:10px; padding:4px 14px; }
.row { padding:10px 0; border-bottom:1px solid var(--line); } .row:last-child { border-bottom:0; }
.label { color:var(--muted); font-size:11px; margin-bottom:2px; } .value { font-weight:500; }
.actions { margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; }
.btn { display:inline-block; padding:4px 12px; border-radius:6px; border:1px solid var(--line); color:var(--text); text-decoration:none; background:var(--bg); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.foot { margin-top:14px; text-align:right; }`;

/** Hela sidan för statusfönstret. */
export function statusPageHtml(m: StatusPageModel, now: Date = new Date()): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>AVA Helper</title><style>${STYLE}</style></head><body>`
    + `<h1>AVA Helper</h1><p class="sub">Version ${esc(m.version)} · öppnar och sparar dokument från AVA</p>`
    + `<div class="card">${updateRow(m, now)}${row("Synk", syncText(m.sync))}${loginRow(m.login)}${startRow(m.openAtLogin)}</div>`
    + `<div class="foot">${button("quit", "Avsluta AVA Helper")}</div></body></html>`;
}
