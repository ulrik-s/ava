/**
 * `taskpane-controller` — den testbara logiken bakom Outlook-add-in:ens
 * task-pane (#72, ADR 0013, funktion 1: spara öppet mail → ärende + tidspost).
 *
 * Office.js-glue:n i `office-addin/taskpane/taskpane.ts` reducerades till en
 * tunn entry (`Office.onReady(() => bootstrap(Office))`); ALL logik bor här och
 * kan enhetstestas UTAN en Office-värd: `Office` injiceras via det smala
 * `OfficeLike`-interfacet och DOM:en körs i happy-dom. Det enda som genuint
 * kräver en värd (att de RIKTIGA Office-API:erna beter sig som interfacet
 * antar) täcks separat av en OWA+Playwright-smoke.
 */

import { createAddinClient } from "@/lib/client/addin/addin-client";
import { saveIncomingMail, type MailSaverClient } from "@/lib/client/addin/save-incoming-mail";

// ─── Smal Office.js-yta (det subset task-panen faktiskt rör) ──────────

export interface RoamingSettings {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  saveAsync(): void;
}
export interface MailboxItem {
  itemId: string;
  subject?: string | null;
  dateTimeCreated?: Date | null;
}
export interface CallbackTokenResult {
  status: string;
  value?: string;
}
export interface Mailbox {
  item: MailboxItem;
  restUrl: string;
  convertToRestId(itemId: string, version: string): string;
  getCallbackTokenAsync(options: { isRest: boolean }, callback: (result: CallbackTokenResult) => void): void;
}
export interface OfficeLike {
  context: { roamingSettings: RoamingSettings; mailbox: Mailbox };
  MailboxEnums: { RestVersion: { v2_0: string } };
}

export interface MatterHit { id: string; matterNumber: string; title: string }
type StatusFn = (msg: string, cls?: string) => void;

/** Smal klient-yta för ärende-söket (uppfylls av `createAddinClient(...)`s
 *  `TRPCClient<AppRouter>`; smal så testdubbletter slipper casts). */
export interface MatterSearchClient {
  matter: {
    list: {
      query: (input: { search?: string; pageSize?: number }) => Promise<{
        matters: ReadonlyArray<{ id: string; matterNumber: string; title: string }>;
      }>;
    };
  };
}

// ─── Ren logik (Office injicerat / mockad fetch) ──────────────────────

/** Ärende-sök via tRPC (`matter.list` med fritext) → vy-träffar. */
export async function searchMatters(client: MatterSearchClient, q: string): Promise<MatterHit[]> {
  const res = await client.matter.list.query({ search: q, pageSize: 8 });
  return res.matters.map((m) => ({ id: m.id, matterNumber: m.matterNumber, title: m.title }));
}

/** REST-token mot mailboxens egen REST-URL (ingen Azure-app krävs). */
export function getRestToken(office: OfficeLike): Promise<string> {
  return new Promise((resolve, reject) => {
    office.context.mailbox.getCallbackTokenAsync({ isRest: true }, (r) => {
      if (r.status === "succeeded" && r.value) resolve(r.value);
      else reject(new Error("Kunde inte hämta REST-token (getCallbackTokenAsync)"));
    });
  });
}

export interface MailContext { restId: string; restBase: string; subject: string; receivedAt: string }

/** Plocka REST-id/-bas + ämne/datum ur Office-item:en. */
export function mailContext(office: OfficeLike): MailContext {
  const mb = office.context.mailbox;
  const { item } = mb;
  return {
    restId: mb.convertToRestId(item.itemId, office.MailboxEnums.RestVersion.v2_0),
    restBase: `${mb.restUrl}/v2.0`,
    subject: item.subject ?? "(utan ämne)",
    receivedAt: (item.dateTimeCreated ?? new Date()).toISOString(),
  };
}

/** Persistera server-URL + PAT i Office roaming-settings (ADR 0013 §3 C1). */
export function persistCreds(office: OfficeLike, server: string, pat: string): void {
  const r = office.context.roamingSettings;
  r.set("ava_server", server);
  r.set("ava_pat", pat);
  r.saveAsync();
}

/**
 * Save-flödet: hämta Office-kontext + REST-token, kör `saveIncomingMail`, och
 * rapportera status. `setSaving` (knapp-disable) injiceras så funktionen är
 * DOM-fri och testbar. Fel fångas → felstatus (shell:en re-enablar via finally).
 */
export async function runSave(opts: {
  office: OfficeLike;
  client: MailSaverClient;
  matter: MatterHit;
  minutes: number;
  setStatus: StatusFn;
  setSaving: (saving: boolean) => void;
}): Promise<void> {
  const { office, client, matter, minutes, setStatus, setSaving } = opts;
  setStatus("Sparar…");
  setSaving(true);
  try {
    const ctx = mailContext(office);
    const token = await getRestToken(office);
    await saveIncomingMail({
      client, graphToken: token, mimeBaseUrl: ctx.restBase, restId: ctx.restId,
      matterId: matter.id, subject: ctx.subject, receivedAt: ctx.receivedAt,
      ...(Number.isFinite(minutes) && minutes > 0 ? { time: { minutes } } : {}),
    });
    setStatus(`✓ Sparat i ${matter.matterNumber}`, "ok");
  } catch (e) {
    setStatus(`Misslyckades: ${errMsg(e)}`, "err");
  } finally {
    setSaving(false);
  }
}

// ─── DOM-glue (happy-dom-testbar; använder global `document`) ──────────

/** Rendera sök-träffarna som klickbara rader; markera vald + rapportera valet. */
export function renderResults(box: HTMLElement, matters: MatterHit[], onPick: (m: MatterHit) => void): void {
  box.innerHTML = "";
  for (const m of matters) {
    const div = document.createElement("div");
    div.className = "matter";
    div.textContent = `${m.matterNumber} — ${m.title}`;
    div.addEventListener("click", () => {
      box.querySelectorAll(".matter").forEach((e) => e.classList.remove("sel"));
      div.classList.add("sel");
      onPick(m);
    });
    box.appendChild(div);
  }
}

/** Klona form-mallen in i #app och koppla upp formuläret. */
export function bootstrap(office: OfficeLike): void {
  const app = document.getElementById("app")!;
  const tpl = document.getElementById("form-tpl") as HTMLTemplateElement;
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  initForm(office);
}

/** Koppla upp formuläret: förifyll creds, sök (debounce), spara. */
export function initForm(office: OfficeLike): void {
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
  $("server").value = office.context.roamingSettings.get("ava_server") ?? "";
  $("pat").value = office.context.roamingSettings.get("ava_pat") ?? "";

  let selected: MatterHit | null = null;
  const setStatus: StatusFn = (msg, cls = "") => {
    const el = document.getElementById("status")!;
    el.textContent = msg;
    el.className = `status ${cls}`;
  };
  const setSaving = (saving: boolean) => { $("save").disabled = saving; };
  const refreshSaveEnabled = () => {
    $("save").disabled = !(selected && $("server").value && $("pat").value);
  };
  const client = () =>
    createAddinClient({ baseUrl: $("server").value.trim(), token: $("pat").value.trim() });

  $("q").addEventListener("input", debounce(async () => {
    const q = $("q").value.trim();
    if (q.length < 2) return;
    try {
      const matters = await searchMatters(client(), q);
      renderResults(document.getElementById("results")!, matters, (m) => { selected = m; refreshSaveEnabled(); });
    } catch (e) {
      setStatus(`Sök misslyckades: ${errMsg(e)}`, "err");
    }
  }, 300));

  ["server", "pat"].forEach((id) => $(id).addEventListener("input", refreshSaveEnabled));

  $("save").addEventListener("click", () => {
    if (!selected) return;
    persistCreds(office, $("server").value.trim(), $("pat").value.trim());
    void runSave({ office, client: client(), matter: selected, minutes: parseInt($("minutes").value, 10), setStatus, setSaving });
  });
}

// ─── Småhjälpare ──────────────────────────────────────────────────────

/** fn får returnera Promise (async-handlers) — vi void:ar den i setTimeout så
 *  no-misused-promises är nöjd och den flytande promise:n är medveten. */
export function debounce<A extends unknown[]>(fn: (...a: A) => unknown, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => { void fn(...a); }, ms); };
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
