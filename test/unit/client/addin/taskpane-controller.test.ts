/**
 * Tester för `taskpane-controller` (#624) — Outlook-add-in:ens task-pane-logik
 * UTAN en Office-värd. `Office` injiceras via `OfficeLike`-interfacet och DOM:en
 * körs i happy-dom; `saveIncomingMail`/`createAddinClient` mockas. Täcker sök,
 * REST-token, mail-kontext, creds-persist, save-flödet (ok/fel/tidspost) +
 * render/bootstrap. Det enda otestade kvar är den ~4-radiga Office-entry:n.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import {
  searchMatters, getRestToken, mailContext, persistCreds, runSave, renderResults, bootstrap,
  type OfficeLike, type MatterHit,
} from "@/lib/client/addin/taskpane-controller";

const saveIncomingMailMock = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/client/addin/save-incoming-mail", () => ({
  saveIncomingMail: (args: unknown) => saveIncomingMailMock(args),
}));
const listQueryMock = vi.fn();
vi.mock("@/lib/client/addin/addin-client", () => ({
  createAddinClient: () => ({
    matter: { list: { query: (input: unknown) => listQueryMock(input) } },
    mail: { saveIncoming: { mutate: vi.fn() } },
  }),
}));

interface OfficeOverrides {
  roaming?: Partial<Record<"ava_server" | "ava_pat", string>>;
  subject?: string | null;
  dateTimeCreated?: Date | null;
  token?: { status: string; value?: string };
}

function makeOffice(o: OfficeOverrides = {}): { office: OfficeLike; set: ReturnType<typeof vi.fn>; saveAsync: ReturnType<typeof vi.fn> } {
  const set = vi.fn();
  const saveAsync = vi.fn();
  const token = o.token ?? { status: "succeeded", value: "rest-token" };
  const office: OfficeLike = {
    context: {
      roamingSettings: { get: (k: string) => o.roaming?.[k as "ava_server" | "ava_pat"], set, saveAsync },
      mailbox: {
        item: {
          itemId: "AAMk-1",
          subject: o.subject === undefined ? "Möte ang. tvist" : o.subject,
          dateTimeCreated: o.dateTimeCreated === undefined ? new Date("2026-02-03T10:00:00.000Z") : o.dateTimeCreated,
        },
        restUrl: "https://outlook.office.com/api",
        convertToRestId: (id: string) => `rest(${id})`,
        getCallbackTokenAsync: (_opts, cb) => cb(token),
      },
    },
    MailboxEnums: { RestVersion: { v2_0: "v2.0" } },
  };
  return { office, set, saveAsync };
}

const matter: MatterHit = { id: "m1", matterNumber: "2026-0007", title: "Tvist" };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("searchMatters", () => {
  it("mappar matter.list-svaret till vy-träffar", async () => {
    const client = {
      matter: { list: { query: vi.fn(async () => ({ matters: [
        { id: "m1", matterNumber: "2026-1", title: "A" },
        { id: "m2", matterNumber: "2026-2", title: "B" },
      ] })) } },
    };
    expect(await searchMatters(client, "tvist")).toEqual([
      { id: "m1", matterNumber: "2026-1", title: "A" },
      { id: "m2", matterNumber: "2026-2", title: "B" },
    ]);
    expect(client.matter.list.query).toHaveBeenCalledWith({ search: "tvist", pageSize: 8 });
  });
});

describe("getRestToken", () => {
  it("resolvar token vid succeeded", async () => {
    const { office } = makeOffice({ token: { status: "succeeded", value: "tok-123" } });
    expect(await getRestToken(office)).toBe("tok-123");
  });
  it("rejectar vid icke-succeeded", async () => {
    const { office } = makeOffice({ token: { status: "failed" } });
    await expect(getRestToken(office)).rejects.toThrow(/REST-token/);
  });
});

describe("mailContext", () => {
  it("bygger restId/restBase/subject/receivedAt", () => {
    const { office } = makeOffice();
    expect(mailContext(office)).toEqual({
      restId: "rest(AAMk-1)",
      restBase: "https://outlook.office.com/api/v2.0",
      subject: "Möte ang. tvist",
      receivedAt: "2026-02-03T10:00:00.000Z",
    });
  });
  it("faller tillbaka på '(utan ämne)' + nu-tid när fälten saknas", () => {
    const { office } = makeOffice({ subject: null, dateTimeCreated: null });
    const ctx = mailContext(office);
    expect(ctx.subject).toBe("(utan ämne)");
    expect(() => new Date(ctx.receivedAt).toISOString()).not.toThrow();
  });
});

describe("persistCreds", () => {
  it("skriver server + pat till roaming och sparar", () => {
    const { office, set, saveAsync } = makeOffice();
    persistCreds(office, "https://srv", "PAT-1");
    expect(set).toHaveBeenCalledWith("ava_server", "https://srv");
    expect(set).toHaveBeenCalledWith("ava_pat", "PAT-1");
    expect(saveAsync).toHaveBeenCalled();
  });
});

describe("runSave", () => {
  const client = { mail: { saveIncoming: { mutate: vi.fn() } } };

  it("kör save-flödet, inkluderar tidspost när minuter > 0, sätter ok-status", async () => {
    const { office } = makeOffice();
    const setStatus = vi.fn();
    const setSaving = vi.fn();
    await runSave({ office, client, matter, minutes: 30, setStatus, setSaving });
    expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.objectContaining({
      graphToken: "rest-token", restId: "rest(AAMk-1)", matterId: "m1",
      subject: "Möte ang. tvist", receivedAt: "2026-02-03T10:00:00.000Z",
      mimeBaseUrl: "https://outlook.office.com/api/v2.0", time: { minutes: 30 },
    }));
    expect(setStatus).toHaveBeenCalledWith("Sparar…");
    expect(setStatus).toHaveBeenLastCalledWith("✓ Sparat i 2026-0007", "ok");
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("utelämnar tidspost när minuter saknas/0", async () => {
    const { office } = makeOffice();
    await runSave({ office, client, matter, minutes: NaN, setStatus: vi.fn(), setSaving: vi.fn() });
    expect(saveIncomingMailMock.mock.calls[0]![0]).not.toHaveProperty("time");
  });

  it("fångar fel → felstatus, re-enablar (setSaving false)", async () => {
    saveIncomingMailMock.mockRejectedValueOnce(new Error("nätfel"));
    const { office } = makeOffice();
    const setStatus = vi.fn();
    const setSaving = vi.fn();
    await runSave({ office, client, matter, minutes: 0, setStatus, setSaving });
    expect(setStatus).toHaveBeenLastCalledWith("Misslyckades: nätfel", "err");
    expect(setSaving).toHaveBeenLastCalledWith(false);
  });
});

describe("renderResults", () => {
  it("renderar klickbara rader; klick markerar + rapporterar valet", () => {
    const box = document.createElement("div");
    const picked: MatterHit[] = [];
    renderResults(box, [matter, { id: "m2", matterNumber: "2026-9", title: "B" }], (m) => picked.push(m));
    const rows = box.querySelectorAll(".matter");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toBe("2026-0007 — Tvist");
    (rows[1] as HTMLElement).click();
    expect(picked).toEqual([{ id: "m2", matterNumber: "2026-9", title: "B" }]);
    expect(rows[1]!.classList.contains("sel")).toBe(true);
  });
});

describe("bootstrap/initForm", () => {
  function setupDom(): void {
    document.body.innerHTML = `
      <div id="app"></div>
      <template id="form-tpl">
        <input id="server"><input id="pat"><input id="q"><input id="minutes">
        <button id="save"></button>
        <div id="results"></div>
        <div id="status"></div>
      </template>`;
  }

  it("klonar formuläret + förifyller creds ur roaming", () => {
    setupDom();
    const { office } = makeOffice({ roaming: { ava_server: "https://srv", ava_pat: "PAT-9" } });
    bootstrap(office);
    expect((document.getElementById("server") as HTMLInputElement).value).toBe("https://srv");
    expect((document.getElementById("pat") as HTMLInputElement).value).toBe("PAT-9");
  });

  it("Spara är disabled tills ett ärende valts (även med server+pat)", () => {
    setupDom();
    const { office } = makeOffice({ roaming: { ava_server: "https://srv", ava_pat: "PAT-9" } });
    bootstrap(office);
    const save = document.getElementById("save") as HTMLButtonElement;
    document.getElementById("server")!.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(true); // inget ärende valt än
  });

  it("hela kedjan: skriv sök → debounce → välj träff → Spara → saveIncomingMail", async () => {
    vi.useFakeTimers();
    try {
      setupDom();
      listQueryMock.mockResolvedValue({ matters: [{ id: "m1", matterNumber: "2026-7", title: "Tvist" }] });
      const { office, set } = makeOffice({ roaming: { ava_server: "https://srv", ava_pat: "PAT-9" } });
      bootstrap(office);

      const q = document.getElementById("q") as HTMLInputElement;
      q.value = "tvist";
      q.dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(350); // debounce (300ms) + sök-resolve

      const row = document.querySelector("#results .matter") as HTMLElement;
      expect(row?.textContent).toBe("2026-7 — Tvist");
      row.click(); // välj ärendet

      const save = document.getElementById("save") as HTMLButtonElement;
      expect(save.disabled).toBe(false); // server+pat+val → aktiv
      save.click();
      await vi.advanceTimersByTimeAsync(1); // flush runSave:s promise-kedja

      expect(set).toHaveBeenCalledWith("ava_server", "https://srv"); // persistCreds
      expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1" }));
    } finally {
      vi.useRealTimers();
    }
  });
});
