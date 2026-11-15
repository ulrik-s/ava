/**
 * `taskpane-controller` — den testbara logiken bakom Outlook-tilläggets
 * task-pane (#72, ADR 0013, funktion 1: spara öppet mail → ärende + tidspost).
 *
 * Ingången `office-addin/taskpane/taskpane.ts` är tunn: `Office.onReady` →
 * `startAddin`. Office injiceras via det smala `OfficeLike`, token via
 * `AddinTokens` (NAA i Outlook, fasta token i test) och DOM:en körs i
 * happy-dom. Det enda som kräver en riktig Outlook-värd är att Office.js
 * beter sig som `OfficeLike` antar.
 *
 * Tillägget ligger på AVA:s egen domän (`/addin/`), så API:t är samma origin.
 */

import { type AddinConfig, type AddinTokens, createAddinTokens } from "@/lib/client/addin/addin-auth";
import { createAddinClient } from "@/lib/client/addin/addin-client";
import { saveIncomingMail, type MailSaverClient } from "@/lib/client/addin/save-incoming-mail";
import { GRAPH_BASE } from "@/lib/client/graph/graph-mail";
import { type AuthFailure, authFailureOf } from "@/lib/shared/auth-failure";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { parseHoursToMinutes, type ParsedHours } from "@/lib/shared/time-hours";

// ─── Smal Office.js-yta (det subset task-panen faktiskt rör) ──────────

export interface MailboxItem {
  itemId: string;
  /** RFC 5322 Message-ID — samma i alla mappar och klienter (dubblettskyddet). */
  internetMessageId?: string | null;
  subject?: string | null;
  dateTimeCreated?: Date | null;
}
export interface Mailbox {
  item: MailboxItem;
  /** EWS-id → REST-id (samma format som Microsoft Graph använder). */
  convertToRestId(itemId: string, version: string): string;
}
export interface OfficeLike {
  context: { mailbox: Mailbox };
  MailboxEnums: { RestVersion: { v2_0: string } };
}

export interface MatterHit { id: MatterId; matterNumber: string; title: string; client?: string }
type StatusFn = (msg: string, cls?: string) => void;

/** Smal klient-yta för ärende-söket (uppfylls av `createAddinClient(...)`). */
export interface MatterSearchClient {
  matter: {
    list: {
      query: (input: { search?: string; pageSize?: number }) => Promise<{
        matters: ReadonlyArray<{
          id: MatterId; matterNumber: string; title: string;
          /** Klienten (rollen KLIENT), om ärendet har en. */
          contacts?: ReadonlyArray<{ contact: { name: string } }>;
        }>;
      }>;
    };
  };
}

/** Smal yta för dubblettfrågan (`mail.findSaved`). */
export interface SavedCheckClient {
  mail: { findSaved: { query: (input: { matterId: MatterId; internetMessageId: string }) => Promise<{ saved: boolean }> } };
}

// ─── Ren logik (Office och token injicerade) ──────────────────────────

/**
 * Ärende-sök via tRPC (`matter.list`): servern söker i nummer, titel, mål-
 * nummer, försäkringsreferens OCH kontakternas namn — klient och motpart.
 */
export async function searchMatters(client: MatterSearchClient, q: string): Promise<MatterHit[]> {
  const res = await client.matter.list.query({ search: q, pageSize: 8 });
  return res.matters.map((m) => {
    const name = m.contacts?.[0]?.contact.name;
    return { id: m.id, matterNumber: m.matterNumber, title: m.title, ...(name ? { client: name } : {}) };
  });
}

/** Finns det öppna mejlet redan i ärendet? Utan Message-ID går det inte att veta → false. */
export async function alreadySaved(client: SavedCheckClient, office: OfficeLike, matterId: MatterId): Promise<boolean> {
  const id = office.context.mailbox.item.internetMessageId;
  return id ? (await client.mail.findSaved.query({ matterId, internetMessageId: id })).saved : false;
}

/** Svarade servern att mejlet redan fanns (`duplicateOf`)? */
function wasDuplicate(result: unknown): boolean {
  return typeof result === "object" && result !== null && Boolean(Reflect.get(result, "duplicateOf"));
}

export interface MailContext { restId: string; subject: string; receivedAt: string }

/** REST-id + ämne/datum ur Office-item:en. */
export function mailContext(office: OfficeLike): MailContext {
  const mb = office.context.mailbox;
  const { item } = mb;
  return {
    restId: mb.convertToRestId(item.itemId, office.MailboxEnums.RestVersion.v2_0),
    subject: item.subject ?? "(utan ämne)",
    receivedAt: (item.dateTimeCreated ?? new Date()).toISOString(),
  };
}

export interface SaveOptions {
  office: OfficeLike;
  client: MailSaverClient;
  tokens: AddinTokens;
  graphBaseUrl: string;
  matter: MatterHit;
  minutes: number;
  /** Tidspostens beskrivning (krävs i panelen när tid anges). */
  description?: string;
  setStatus: StatusFn;
  setSaving: (saving: boolean) => void;
}

/**
 * Save-flödet: Graph-token, `saveIncomingMail`, status. `setSaving`
 * (knapp-disable) injiceras så funktionen är DOM-fri. Fel → felstatus.
 */
export async function runSave(opts: SaveOptions): Promise<void> {
  const { office, client, tokens, graphBaseUrl, matter, minutes, description, setStatus, setSaving } = opts;
  setStatus("Sparar…");
  setSaving(true);
  try {
    const ctx = mailContext(office);
    const messageId = office.context.mailbox.item.internetMessageId;
    const result = await saveIncomingMail({
      client, graphToken: await tokens.graph(), mimeBaseUrl: graphBaseUrl, restId: ctx.restId,
      matterId: matter.id, subject: ctx.subject, receivedAt: ctx.receivedAt,
      ...(messageId ? { internetMessageId: messageId } : {}),
      ...(Number.isFinite(minutes) && minutes > 0
        ? { time: { minutes, ...(description?.trim() ? { description: description.trim() } : {}) } }
        : {}),
    });
    if (wasDuplicate(result)) setStatus(`Mejlet fanns redan i ${matter.matterNumber} — inget sparades igen.`, "warn");
    else setStatus(`✓ Sparat i ${matter.matterNumber}`, "ok");
  } catch (e) {
    setStatus(`Misslyckades: ${friendlyError(e)}`, "err");
  } finally {
    setSaving(false);
  }
}

// ─── DOM-glue (happy-dom-testbar; använder global `document`) ──────────

/** Ett element i task-panen; saknas det är HTML:en och koden ur takt (testas i addin-package.test.ts). */
function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} saknas i task-panen`);
  return found;
}

/** Rendera sök-träffarna som klickbara rader; markera vald + rapportera valet. */
export function renderResults(box: HTMLElement, matters: MatterHit[], onPick: (m: MatterHit) => void): void {
  box.innerHTML = "";
  for (const m of matters) {
    const div = document.createElement("div");
    div.className = "matter";
    div.textContent = `${m.matterNumber} — ${m.title}`;
    if (m.client) {
      const who = document.createElement("div");
      who.className = "client";
      who.textContent = `Klient: ${m.client}`;
      div.appendChild(who);
    }
    div.addEventListener("click", () => {
      box.querySelectorAll(".matter").forEach((e) => e.classList.remove("sel"));
      div.classList.add("sel");
      onPick(m);
    });
    box.appendChild(div);
  }
}

export interface PaneOptions {
  /** AVA:s origin (tillägget ligger på samma domän). */
  server: string;
  graphBaseUrl: string;
}

/** Klona form-mallen in i #app och koppla upp formuläret. */
export function bootstrap(office: OfficeLike, tokens: AddinTokens, opts: PaneOptions): void {
  const app = el("app");
  const tpl = el("form-tpl") as HTMLTemplateElement;
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  initForm(office, tokens, opts);
}

/**
 * Ingången: konfiguration (config.js) → token → formuläret. Saknas
 * konfigurationen eller misslyckas inloggningen visas det i panelen.
 */
export async function startAddin(office: OfficeLike, config: AddinConfig | undefined, origin: string,
  create?: Parameters<typeof createAddinTokens>[1]): Promise<void> {
  const app = el("app");
  if (!config) {
    app.textContent = "Tillägget är inte konfigurerat för den här AVA-installationen — kontakta administratören.";
    return;
  }
  const tokens = await createAddinTokens(config, create);
  bootstrap(office, tokens, { server: origin, graphBaseUrl: config.graphBaseUrl ?? GRAPH_BASE });
}

/** Koppla upp formuläret: inloggning, sök (debounce), spara. */
export function initForm(office: OfficeLike, tokens: AddinTokens, opts: PaneOptions): void {
  const $ = (id: string) => el(id) as HTMLInputElement;
  let selected: MatterHit | null = null;
  const setStatus: StatusFn = (msg, cls = "") => {
    const status = el("status");
    status.textContent = msg;
    status.className = `status ${cls}`;
  };
  const setSaving = (saving: boolean) => { $("save").disabled = saving; };
  const client = async () => createAddinClient({ baseUrl: opts.server, token: await tokens.ava() });

  /** Valt ärende: Spara blir aktiv — om mejlet inte redan finns där. */
  const checkSaved = async (m: MatterHit): Promise<void> => {
    $("save").disabled = true;
    setStatus("");
    try {
      if (await alreadySaved(await client(), office, m.id)) {
        if (selected === m) setStatus(`Mejlet finns redan i ${m.matterNumber}.`, "warn");
        return;
      }
    } catch {
      // Frågan är bara en hjälp; servern stoppar ändå en dubblett vid Spara.
    }
    if (selected === m) $("save").disabled = false;
  };

  // Hämta AVA-token direkt: då syns vem som är inloggad, eller varför inte.
  void tokens.ava().then(() => {
    const u = tokens.user();
    el("who").textContent = u ? `Inloggad som ${u.name}` : "";
  }, (e: unknown) => { setStatus(`Inloggningen misslyckades: ${friendlyError(e)}`, "err"); });

  $("q").addEventListener("input", debounce(async () => {
    const q = $("q").value.trim();
    if (q.length < 2) return;
    try {
      const matters = await searchMatters(await client(), q);
      renderResults(el("results"), matters, (m) => { selected = m; void checkSaved(m); });
    } catch (e) {
      setStatus(`Sök misslyckades: ${friendlyError(e)}`, "err");
    }
  }, 300));

  $("save").addEventListener("click", () => {
    if (!selected) return;
    const time = timeFieldMinutes($("minutes").value);
    if (!time.ok) { setStatus(time.error, "err"); return; }
    const description = $("description").value.trim(); // tid utan beskrivning går inte att fakturera
    if (time.minutes > 0 && !description) { setStatus("Skriv en beskrivning för tidsposten.", "err"); $("description").focus(); return; }
    const matter = selected;
    void client().then(
      (c) => runSave({ office, client: c, tokens, graphBaseUrl: opts.graphBaseUrl, matter, minutes: time.minutes, description, setStatus, setSaving }),
      (e: unknown) => { setStatus(`Misslyckades: ${friendlyError(e)}`, "err"); },
    );
  });
}

// ─── Småhjälpare ──────────────────────────────────────────────────────

/** Tidsfältet i timmar (#1545): tomt → ingen tidspost (0 min), annars den
 *  gemensamma regeln — ett otillåtet värde ger ett fel, aldrig en avrundning. */
export function timeFieldMinutes(raw: string): ParsedHours {
  return raw.trim() === "" ? { ok: true, minutes: 0 } : parseHoursToMinutes(raw);
}

/** fn får returnera Promise (async-handlers) — vi void:ar den i setTimeout så
 *  no-misused-promises är nöjd och den flytande promise:n är medveten. */
export function debounce<A extends unknown[]>(fn: (...a: A) => unknown, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => { void fn(...a); }, ms); };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Vad juristen ska läsa när servern svarar 401 (skälet: `data.authFailure`, auth-failure.ts). */
const AUTH_FAILURE_TEXT: Readonly<Record<AuthFailure, string>> = {
  "account-inactive": "ditt konto finns inte i AVA eller är inte aktivt — kontakta administratören.",
  "token-expired": "inloggningen har gått ut — stäng och öppna tillägget igen.",
  "no-identity": "AVA kände inte igen inloggningen — kontakta administratören.",
};

/** Felet så som en jurist ska läsa det: serverns skälkod i första hand, annars meddelandet. */
export function friendlyError(e: unknown): string {
  const reason = authFailureOf(e);
  return reason ? AUTH_FAILURE_TEXT[reason] : errMsg(e);
}
