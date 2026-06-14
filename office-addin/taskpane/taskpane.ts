/**
 * AVA Outlook task-pane — funktion 1 (#72, ADR 0013): spara det öppna mailet
 * som `.eml` i valt ärende + valfri tidspost.
 *
 * Detta är den TUNNA Office.js-glue:n (ej CI-verifierbar — kräver Office-värd).
 * All testad affärslogik ligger i `src/lib/client/`:
 *   - `createAddinClient` — typad tRPC-klient mot AVA-servern (Bearer-PAT).
 *   - `saveIncomingMail`  — Graph/Outlook-REST `$value` → `mail.saveIncoming`.
 *
 * Token-modell: AVA-servern auktoriseras med en PAT (klistras in, lagras i
 * Office roaming-settings, ADR 0013 §3 C1). MIME:n hämtas med en
 * `getCallbackTokenAsync`-REST-token mot mailboxens egen REST-URL — funkar vid
 * sideload UTAN Azure-app-registrering. (Alternativ: Graph + SSO/OBO; se README.)
 *
 * Build: `bun run office-addin/build.ts` → taskpane.js (HTTPS-serveras).
 */

import { createAddinClient } from "@/lib/client/addin/addin-client";
import { saveIncomingMail } from "@/lib/client/addin/save-incoming-mail";

// Office.js laddas globalt via <script> i taskpane.html. Lös typning (denna
// fil typecheckas inte av huvud-tsconfig:en — den byggs separat).
declare const Office: any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface MatterHit { id: string; matterNumber: string; title: string }
type AddinClient = ReturnType<typeof createAddinClient>;

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const ROAM = () => Office.context.roamingSettings;

Office.onReady(() => {
  const app = document.getElementById("app")!;
  const tpl = document.getElementById("form-tpl") as HTMLTemplateElement;
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  initForm();
});

function initForm(): void {
  // Förifyll server/PAT ur roaming-settings.
  $("server").value = ROAM().get("ava_server") ?? "";
  $("pat").value = ROAM().get("ava_pat") ?? "";

  let selected: MatterHit | null = null;
  const setStatus = (msg: string, cls = "") => {
    const el = document.getElementById("status")!;
    el.textContent = msg;
    el.className = `status ${cls}`;
  };
  const refreshSaveEnabled = () => {
    ($("save")).disabled = !(selected && $("server").value && $("pat").value);
  };

  const client = (): AddinClient =>
    createAddinClient({ baseUrl: $("server").value.trim(), token: $("pat").value.trim() });

  $("q").addEventListener("input", debounce(async () => {
    const q = $("q").value.trim();
    if (q.length < 2) return;
    try {
      const matters = await searchMatters(client(), q);
      renderResults(matters, (m) => { selected = m; refreshSaveEnabled(); });
    } catch (e) {
      setStatus(`Sök misslyckades: ${errMsg(e)}`, "err");
    }
  }, 300));

  ["server", "pat"].forEach((id) => $(id).addEventListener("input", refreshSaveEnabled));

  $("save").addEventListener("click", () => {
    if (!selected) return;
    void doSave(client(), selected, setStatus);
  });
}

/** Ärende-sök via tRPC (`matter.list` med fritext). */
async function searchMatters(c: AddinClient, q: string): Promise<MatterHit[]> {
  const res: any = await (c as any).matter.list.query({ search: q, pageSize: 8 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = Array.isArray(res) ? res : res.matters ?? res.items ?? [];
  return rows.map((m: any) => ({ id: m.id, matterNumber: m.matterNumber, title: m.title })); // eslint-disable-line @typescript-eslint/no-explicit-any
}

function renderResults(matters: MatterHit[], onPick: (m: MatterHit) => void): void {
  const box = document.getElementById("results")!;
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

/** Hämta REST-token + restId + ämne/datum ur Office och kör save-flödet. */
async function doSave(c: AddinClient, matter: MatterHit, setStatus: (m: string, c?: string) => void): Promise<void> {
  setStatus("Sparar…");
  ($("save")).disabled = true;
  try {
    ROAM().set("ava_server", $("server").value.trim());
    ROAM().set("ava_pat", $("pat").value.trim());
    ROAM().saveAsync();

    const item = Office.context.mailbox.item;
    const restId = Office.context.mailbox.convertToRestId(item.itemId, Office.MailboxEnums.RestVersion.v2_0);
    const restBase = `${Office.context.mailbox.restUrl}/v2.0`;
    const token = await getRestToken();
    const minutes = parseInt($("minutes").value, 10);

    await saveIncomingMail({
      client: c as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      graphToken: token,
      mimeBaseUrl: restBase,
      restId,
      matterId: matter.id,
      subject: item.subject ?? "(utan ämne)",
      receivedAt: (item.dateTimeCreated ?? new Date()).toISOString(),
      ...(Number.isFinite(minutes) && minutes > 0 ? { time: { minutes } } : {}),
    });
    setStatus(`✓ Sparat i ${matter.matterNumber}`, "ok");
  } catch (e) {
    setStatus(`Misslyckades: ${errMsg(e)}`, "err");
  } finally {
    ($("save")).disabled = false;
  }
}

/** REST-token mot mailboxens egen REST-URL (ingen Azure-app krävs). */
function getRestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.getCallbackTokenAsync({ isRest: true }, (r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (r.status === "succeeded") resolve(r.value);
      else reject(new Error("Kunde inte hämta REST-token (getCallbackTokenAsync)"));
    });
  });
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  let t: ReturnType<typeof setTimeout>;
  return ((...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
