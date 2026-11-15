/**
 * Tester för `taskpane-controller` (#624) — Outlook-tilläggets task-pane-logik
 * UTAN en Office-värd. `Office` injiceras via `OfficeLike`, token via
 * `AddinTokens` (fasta i testerna) och DOM:en körs i happy-dom;
 * `saveIncomingMail`/`createAddinClient` mockas. Täcker sök, mail-kontext,
 * save-flödet (ok/fel/tidspost), inloggningen i panelen, begripliga fel och
 * hela kedjan sök → välj → spara.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { AddinTokens } from "@/lib/client/addin/addin-auth";
import {
  searchMatters, mailContext, runSave, renderResults, bootstrap, startAddin, timeFieldMinutes, friendlyError,
  type OfficeLike, type MatterHit,
} from "@/lib/client/addin/taskpane-controller";
import { GRAPH_BASE } from "@/lib/client/graph/graph-mail";
import { asId } from "@/lib/shared/schemas/ids";

const saveIncomingMailMock = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/client/addin/save-incoming-mail", () => ({
  saveIncomingMail: (args: unknown) => saveIncomingMailMock(args),
}));
const listQueryMock = vi.fn();
const clientTokens: string[] = [];
vi.mock("@/lib/client/addin/addin-client", () => ({
  createAddinClient: (opts: { baseUrl: string; token: string }) => {
    clientTokens.push(`${opts.baseUrl}|${opts.token}`);
    return {
      matter: { list: { query: (input: unknown) => listQueryMock(input) } },
      mail: { saveIncoming: { mutate: vi.fn() } },
    };
  },
}));

function makeOffice(o: { subject?: string | null; dateTimeCreated?: Date | null } = {}): OfficeLike {
  return {
    context: {
      mailbox: {
        item: {
          itemId: "AAMk-1",
          subject: o.subject === undefined ? "Möte ang. tvist" : o.subject,
          dateTimeCreated: o.dateTimeCreated === undefined ? new Date("2026-02-03T10:00:00.000Z") : o.dateTimeCreated,
        },
        convertToRestId: (id: string) => `rest(${id})`,
      },
    },
    MailboxEnums: { RestVersion: { v2_0: "v2.0" } },
  };
}

function makeTokens(o: { avaFails?: Error } = {}): AddinTokens {
  return {
    ava: () => (o.avaFails ? Promise.reject(o.avaFails) : Promise.resolve("ava-token")),
    graph: () => Promise.resolve("graph-token"),
    user: () => ({ name: "Cecilia Moll", username: "cecilia@mgadvokater.se" }),
  };
}

/** Så som tRPC-klienten ger serverns 401: skälet i `data.authFailure` (trpc-core.ts). */
function authError(reason: "no-identity" | "token-expired" | "account-inactive"): Error {
  return Object.assign(new Error("Ingen giltig inloggning."), { data: { code: "UNAUTHORIZED", authFailure: reason } });
}

const matter: MatterHit = { id: asId<"MatterId">("m1"), matterNumber: "2026-0007", title: "Tvist" };
const OPTS = { server: "https://ava.example", graphBaseUrl: GRAPH_BASE };

beforeEach(() => {
  vi.clearAllMocks();
  clientTokens.length = 0;
  document.body.innerHTML = "";
});

describe("searchMatters", () => {
  it("mappar matter.list-svaret till vy-träffar", async () => {
    const client = {
      matter: { list: { query: vi.fn(async () => ({ matters: [
        { id: asId<"MatterId">("m1"), matterNumber: "2026-1", title: "A" },
        { id: asId<"MatterId">("m2"), matterNumber: "2026-2", title: "B" },
      ] })) } },
    };
    expect(await searchMatters(client, "20")).toEqual([
      { id: "m1", matterNumber: "2026-1", title: "A" },
      { id: "m2", matterNumber: "2026-2", title: "B" },
    ]);
    expect(client.matter.list.query).toHaveBeenCalledWith({ search: "20", pageSize: 8 });
  });
});

describe("mailContext", () => {
  it("bygger restId/subject/receivedAt", () => {
    expect(mailContext(makeOffice())).toEqual({
      restId: "rest(AAMk-1)", subject: "Möte ang. tvist", receivedAt: "2026-02-03T10:00:00.000Z",
    });
  });

  it("faller tillbaka på '(utan ämne)' + nu-tid när fälten saknas", () => {
    const ctx = mailContext(makeOffice({ subject: null, dateTimeCreated: null }));
    expect(ctx.subject).toBe("(utan ämne)");
    expect(Date.parse(ctx.receivedAt)).not.toBeNaN();
  });
});

describe("runSave", () => {
  const client = { mail: { saveIncoming: { mutate: vi.fn() } } };

  it("hämtar mejlet via Graph med Graph-token:en, med tidspost, och sätter ok-status", async () => {
    const setStatus = vi.fn();
    const setSaving = vi.fn();
    await runSave({ office: makeOffice(), client, tokens: makeTokens(), graphBaseUrl: GRAPH_BASE, matter, minutes: 30, setStatus, setSaving });
    expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.objectContaining({
      graphToken: "graph-token", restId: "rest(AAMk-1)", matterId: "m1",
      subject: "Möte ang. tvist", receivedAt: "2026-02-03T10:00:00.000Z",
      mimeBaseUrl: "https://graph.microsoft.com/v1.0", time: { minutes: 30 },
    }));
    expect(setStatus).toHaveBeenCalledWith("Sparar…");
    expect(setStatus).toHaveBeenLastCalledWith("✓ Sparat i 2026-0007", "ok");
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("utelämnar tidspost när minuter saknas/0", async () => {
    await runSave({ office: makeOffice(), client, tokens: makeTokens(), graphBaseUrl: GRAPH_BASE, matter, minutes: NaN, setStatus: vi.fn(), setSaving: vi.fn() });
    expect(saveIncomingMailMock.mock.calls[0]![0]).not.toHaveProperty("time");
  });

  it("fångar fel → felstatus, re-enablar (setSaving false)", async () => {
    saveIncomingMailMock.mockRejectedValueOnce(new Error("nätfel"));
    const setStatus = vi.fn();
    const setSaving = vi.fn();
    await runSave({ office: makeOffice(), client, tokens: makeTokens(), graphBaseUrl: GRAPH_BASE, matter, minutes: 0, setStatus, setSaving });
    expect(setStatus).toHaveBeenLastCalledWith("Misslyckades: nätfel", "err");
    expect(setSaving).toHaveBeenLastCalledWith(false);
  });
});

describe("friendlyError", () => {
  it("översätter serverns skälkod (data.authFailure) till något en jurist förstår", () => {
    expect(friendlyError(authError("account-inactive"))).toContain("finns inte i AVA");
    expect(friendlyError(authError("token-expired"))).toContain("gått ut");
    expect(friendlyError(authError("no-identity"))).toContain("kände inte igen");
    expect(friendlyError(new Error("nätfel"))).toBe("nätfel");
  });
});

describe("renderResults", () => {
  it("renderar klickbara rader; klick markerar + rapporterar valet", () => {
    const box = document.createElement("div");
    const picked: MatterHit[] = [];
    renderResults(box, [matter, { id: asId<"MatterId">("m2"), matterNumber: "2026-9", title: "B" }], (m) => picked.push(m));
    const rows = box.querySelectorAll(".matter");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toBe("2026-0007 — Tvist");
    (rows[1] as HTMLElement).click();
    expect(picked).toEqual([{ id: "m2", matterNumber: "2026-9", title: "B" }]);
    expect(rows[1]!.classList.contains("sel")).toBe(true);
  });
});

describe("timeFieldMinutes (#1545)", () => {
  it("tid i timmar → minuter; komma och punkt", () => {
    expect(timeFieldMinutes("0,25")).toEqual({ ok: true, minutes: 15 });
    expect(timeFieldMinutes("1.5")).toEqual({ ok: true, minutes: 90 });
  });
  it("tomt fält → ingen tidspost (0 minuter)", () => {
    expect(timeFieldMinutes("  ")).toEqual({ ok: true, minutes: 0 });
  });
  it("otillåtet värde → fel, ingen avrundning", () => {
    expect(timeFieldMinutes("0,33").ok).toBe(false);
  });
});

describe("panelen", () => {
  function setupDom(): void {
    document.body.innerHTML = `
      <div id="app"></div>
      <template id="form-tpl">
        <div id="who"></div><input id="q"><input id="minutes"><input id="description">
        <button id="save" disabled></button>
        <div id="results"></div>
        <div id="status"></div>
      </template>`;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("visar vem som är inloggad, och Spara är avstängd tills ett ärende valts", async () => {
    setupDom();
    bootstrap(makeOffice(), makeTokens(), OPTS);
    await flush();
    expect(document.getElementById("who")?.textContent).toBe("Inloggad som Cecilia Moll");
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("misslyckad inloggning syns i panelen", async () => {
    setupDom();
    bootstrap(makeOffice(), makeTokens({ avaFails: authError("account-inactive") }), OPTS);
    await flush();
    expect(document.getElementById("status")?.textContent).toContain("finns inte i AVA");
    expect(document.getElementById("status")?.className).toContain("err");
  });

  it("utan konfiguration (config.js) visas det i stället för formuläret", async () => {
    setupDom();
    await startAddin(makeOffice(), undefined, "https://ava.example");
    expect(document.getElementById("app")?.textContent).toContain("inte konfigurerat");
  });

  it("med konfiguration: formuläret, mot sidans egen origin", async () => {
    setupDom();
    await startAddin(makeOffice(), { clientId: "c", tenantId: "t", staticTokens: { ava: "a", graph: "g", name: "Björn" } }, "https://ava.example");
    await flush();
    expect(document.getElementById("who")?.textContent).toBe("Inloggad som Björn");
  });

  /** Sök + välj ärendet, fyll tid och beskrivning och klicka Spara. */
  async function searchPickSave(hours: string, description = "Genomgång av underlag"): Promise<void> {
    setupDom();
    listQueryMock.mockResolvedValue({ matters: [{ id: "m1", matterNumber: "2026-7", title: "Tvist" }] });
    bootstrap(makeOffice(), makeTokens(), OPTS);
    const q = document.getElementById("q") as HTMLInputElement;
    q.value = "tvist";
    q.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(350); // debounce (300ms) + sök-resolve
    (document.querySelector("#results .matter") as HTMLElement).click();
    (document.getElementById("minutes") as HTMLInputElement).value = hours;
    (document.getElementById("description") as HTMLInputElement).value = description;
    (document.getElementById("save") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(1);
  }

  it("hela kedjan: sök → välj → Spara; klienten får AVA-token:en och sidans origin", async () => {
    vi.useFakeTimers();
    try {
      await searchPickSave("");
      expect(clientTokens).toContain("https://ava.example|ava-token");
      expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.objectContaining({ matterId: "m1", graphToken: "graph-token" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("tid i timmar + beskrivning: 0,25 skickas som 15 minuter med raden (#1545)", async () => {
    vi.useFakeTimers();
    try {
      await searchPickSave("0,25", "  Genomgång av underlag  ");
      expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.objectContaining({
        time: { minutes: 15, description: "Genomgång av underlag" },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("tid utan beskrivning stoppas med en förklaring", async () => {
    vi.useFakeTimers();
    try {
      await searchPickSave("0,5", "   ");
      expect(saveIncomingMailMock).not.toHaveBeenCalled();
      expect(document.getElementById("status")?.textContent).toBe("Skriv en beskrivning för tidsposten.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("utan tid behövs ingen beskrivning", async () => {
    vi.useFakeTimers();
    try {
      await searchPickSave("", "");
      expect(saveIncomingMailMock).toHaveBeenCalledWith(expect.not.objectContaining({ time: expect.anything() }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("ett otillåtet värde ger felstatus och ingen tidspost (#1545)", async () => {
    vi.useFakeTimers();
    try {
      await searchPickSave("0,33");
      expect(saveIncomingMailMock).not.toHaveBeenCalled();
      expect(document.getElementById("status")?.textContent).toContain("Ändra värdet");
      expect(document.getElementById("status")?.className).toContain("err");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sökfel visas begripligt", async () => {
    vi.useFakeTimers();
    try {
      setupDom();
      listQueryMock.mockRejectedValue(authError("no-identity"));
      bootstrap(makeOffice(), makeTokens(), OPTS);
      const q = document.getElementById("q") as HTMLInputElement;
      q.value = "tvist";
      q.dispatchEvent(new Event("input"));
      await vi.advanceTimersByTimeAsync(350);
      expect(document.getElementById("status")?.textContent).toContain("Sök misslyckades");
    } finally {
      vi.useRealTimers();
    }
  });
});
