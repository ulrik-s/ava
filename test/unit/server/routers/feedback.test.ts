/**
 * `feedback.submit` / `feedback.mine`: användarens text blir en issue i det
 * privata intag-repot med serverns kontext överst, användaren ser bara sina
 * egna förfrågningar, och ingen kan skicka mer än FEEDBACK_PER_HOUR i timmen.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import type { FeedbackComment, FeedbackIssue, IFeedbackSink } from "@/lib/server/ports";
import {
  feedbackRouter, FEEDBACK_PER_HOUR, issueBody, messagesFrom, mineFrom, neutralize, ownerMarker, REPLIES_PER_HOUR,
  replyBody, resetFeedbackRateLimit,
} from "@/lib/server/routers/feedback";
import {
  feedbackState, hasUnread, isFinished, lastActivity, releaseFromLabels, sortForList, TO_USER_MARKER, unreadCount,
  userReplyMarker, type FeedbackItem,
} from "@/lib/shared/feedback";
import { setLogSink, nullSink, type LogRecord } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

const USER = { id: asId<"UserId">("u-1"), email: "a@byra.se", name: "Anna", role: "LAWYER" as const, organizationId: asId<"OrganizationId">("org-1") };

function fakeSink(existing: FeedbackIssue[] = [], comments: Record<number, FeedbackComment[]> = {}) {
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const posted: Array<{ number: number; body: string }> = [];
  const read: number[] = [];
  const sink: IFeedbackSink = {
    create: (i) => { created.push(i); return Promise.resolve({ number: 41 + created.length }); },
    list: () => Promise.resolve(existing),
    comments: (n) => { read.push(n); return Promise.resolve(comments[n] ?? []); },
    comment: (number, body) => { posted.push({ number, body }); return Promise.resolve(); },
  };
  return { sink, created, posted, read };
}

const issue = (n: number, body: string, labels: string[], open = true, comments = 0): FeedbackIssue =>
  ({ number: n, title: `t${n}`, body, open, labels, createdAt: `2026-11-0${n}T10:00:00Z`, comments });
const comment = (id: number, body: string, createdAt: string, viaApp: string | null = null): FeedbackComment =>
  ({ id, body, createdAt, viaApp });

function caller(sink?: IFeedbackSink, user = USER) {
  // Minimal kontext: routern rör bara user, orgId, ports.feedback och requestId.
  return feedbackRouter.createCaller({ user, orgId: user.organizationId, requestId: "req-1", ports: sink ? { feedback: sink } : {} } as never);
}

const INPUT = { kind: "bug" as const, title: "Fakturan @ulrik visas fel", body: "Klient Andersson: summan blir fel\nandra raden", page: "/invoices/7", userAgent: "Firefox" };

const logged: LogRecord[] = [];
beforeEach(() => { resetFeedbackRateLimit(); logged.length = 0; setLogSink((r) => { logged.push(r); }); });
afterEach(() => { setLogSink(nullSink); delete process.env.AVA_RELEASE; });

describe("feedback.submit", () => {
  it("skapar en issue med kontext, citerad text och etiketter", async () => {
    process.env.AVA_RELEASE = "v0.4.0";
    const { sink, created } = fakeSink();
    expect(await caller(sink).submit(INPUT)).toEqual({ number: 42 });
    const issue = created[0];
    expect(issue?.labels).toEqual(["user-request", "bugg"]);
    expect(issue?.title).toBe("Fakturan @​ulrik visas fel");
    expect(issue?.body.startsWith(ownerMarker("u-1"))).toBe(true);
    expect(issue?.body).toContain("**Release:** v0.4.0");
    expect(issue?.body).toContain("**Sida:** `/invoices/7`");
    expect(issue?.body).toContain("> Klient Andersson: summan blir fel\n> andra raden");
  });

  it("förslag får etiketten förslag", async () => {
    const { sink, created } = fakeSink();
    await caller(sink).submit({ ...INPUT, kind: "feature" });
    expect(created[0]?.labels).toEqual(["user-request", "förslag"]);
  });

  it("loggar bara id:n, aldrig texten", async () => {
    await caller(fakeSink().sink).submit(INPUT);
    expect(JSON.stringify(logged)).not.toContain("Andersson");
    expect(logged.some((r) => r.event === "feedback.submitted")).toBe(true);
  });

  it(`högst ${FEEDBACK_PER_HOUR} i timmen per användare`, async () => {
    const { sink } = fakeSink();
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++) await caller(sink).submit(INPUT);
    await expect(caller(sink).submit(INPUT)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // En annan användare påverkas inte.
    await expect(caller(sink, { ...USER, id: asId<"UserId">("u-2") }).submit(INPUT)).resolves.toBeDefined();
  });

  it("för kort text avvisas", async () => {
    await expect(caller(fakeSink().sink).submit({ ...INPUT, body: "kort" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("utan port (webbläsaren, eller servern utan token): NOT_IMPLEMENTED", async () => {
    await expect(caller().submit(INPUT)).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    await expect(caller().mine()).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

describe("feedback.mine", () => {
  it("bara mina, nyast först, med status och release", async () => {
    const mine1 = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request", "bugg", "undersökt", "verifierad"]);
    const mine2 = issue(2, `${ownerMarker("u-1")}\n…`, ["user-request", "förslag", "levererad", "release:v0.5.0"], false);
    const other = issue(3, `${ownerMarker("u-2")}\n…`, ["user-request"]);
    // Någon klistrar in min markör i sin text — räknas inte, markören måste stå först.
    const forged = issue(4, `${ownerMarker("u-2")}\n> ${ownerMarker("u-1")}`, ["user-request"]);
    const items = await caller(fakeSink([mine1, mine2, other, forged]).sink).mine();
    expect(items.map((i) => [i.number, i.kind, i.state, i.release])).toEqual([
      [2, "feature", "levererad", "v0.5.0"],
      [1, "bug", "verifierad", null],
    ]);
  });

  it("mineFrom är tom när inget matchar", () => {
    expect(mineFrom([], "u-1")).toEqual([]);
  });

  it("dialogen: bara frågor till mig och mina svar — rapporter och andras svar syns inte", async () => {
    const mine = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request", "bugg", "väntar-på-användaren"], true, 4);
    const { sink, read } = fakeSink([mine, issue(2, `${ownerMarker("u-1")}\n…`, ["user-request"])], {
      1: [
        comment(10, "## Verifieringsrapport\nintern detalj", "2026-11-10T08:00:00Z", "claude"),
        comment(11, `${TO_USER_MARKER}\nVilken faktura gäller det?\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`, "2026-11-10T08:01:00Z", "claude"),
        comment(12, `${userReplyMarker("u-1")}\n\n> Faktura 2026-17\n> rad två`, "2026-11-10T09:00:00Z"),
        comment(13, `${userReplyMarker("u-2")}\n\n> någon annan`, "2026-11-10T09:30:00Z"),
        comment(14, `${TO_USER_MARKER}\nTack, jag tittar på det.`, "2026-11-10T10:00:00Z"),
      ],
    });
    const [first] = (await caller(sink).mine()).filter((i) => i.number === 1);
    expect(first?.state).toBe("vantar_pa_dig");
    expect(first?.canReply).toBe(true);
    expect(first?.messages).toEqual([
      { id: 11, from: "claude", body: "Vilken faktura gäller det?", createdAt: "2026-11-10T08:01:00Z" },
      { id: 12, from: "du", body: "Faktura 2026-17\nrad två", createdAt: "2026-11-10T09:00:00Z" },
      { id: 14, from: "ulrik", body: "Tack, jag tittar på det.", createdAt: "2026-11-10T10:00:00Z" },
    ]);
    // Issue 2 saknar kommentarer → ingen läsning.
    expect(read).toEqual([1]);
  });
});

describe("feedback.reply", () => {
  const open = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request", "väntar-på-användaren"]);

  it("skriver svaret med markör och citerad, neutraliserad text", async () => {
    const { sink, posted } = fakeSink([open]);
    await caller(sink).reply({ number: 1, body: "Faktura @bob\n<!-- smuggel -->" });
    expect(posted).toEqual([{ number: 1, body: replyBody("u-1", "Faktura @bob\n<!-- smuggel -->") }]);
    expect(posted[0]?.body.startsWith(userReplyMarker("u-1"))).toBe(true);
    expect(posted[0]?.body).toContain("> Faktura @​bob\n> &lt;!-- smuggel -->");
    expect(logged.some((r) => r.event === "feedback.replied")).toBe(true);
    expect(JSON.stringify(logged)).not.toContain("Faktura");
  });

  it("en annans förfrågan finns inte", async () => {
    const { sink, posted } = fakeSink([issue(1, `${ownerMarker("u-2")}\n…`, ["user-request"])]);
    await expect(caller(sink).reply({ number: 1, body: "hej" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(posted).toEqual([]);
  });

  it("stängd eller levererad går inte att svara på", async () => {
    const closed = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request"], false);
    await expect(caller(fakeSink([closed]).sink).reply({ number: 1, body: "hej" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const delivered = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request", "levererad"]);
    await expect(caller(fakeSink([delivered]).sink).reply({ number: 1, body: "hej" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it(`högst ${REPLIES_PER_HOUR} svar i timmen`, async () => {
    const { sink } = fakeSink([open]);
    for (let i = 0; i < REPLIES_PER_HOUR; i++) await caller(sink).reply({ number: 1, body: "svar" });
    await expect(caller(sink).reply({ number: 1, body: "svar" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("tomt svar avvisas", async () => {
    await expect(caller(fakeSink([open]).sink).reply({ number: 1, body: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("olästa meddelanden", () => {
  const item = (number: number, msgs: Array<[ "claude" | "ulrik" | "du", string]>): FeedbackItem => ({
    number, title: "t", kind: "bug", state: "vantar_pa_dig", createdAt: "x", release: null, canReply: true,
    messages: msgs.map(([from, createdAt], i) => ({ id: i, from, body: "b", createdAt })),
  });

  it("oläst när det senaste meddelandet till mig är nyare än när jag läste", () => {
    const i = item(1, [["claude", "2026-11-10T08:00:00Z"]]);
    expect(hasUnread(i, {})).toBe(true);
    expect(hasUnread(i, { "1": "2026-11-10T07:00:00Z" })).toBe(true);
    expect(hasUnread(i, { "1": "2026-11-10T08:00:00Z" })).toBe(false);
  });

  it("mitt eget svar gör inget oläst, och utan meddelanden finns inget att läsa", () => {
    expect(hasUnread(item(1, [["claude", "2026-11-10T08:00:00Z"], ["du", "2026-11-10T09:00:00Z"]]), { "1": "2026-11-10T08:30:00Z" })).toBe(false);
    expect(hasUnread(item(2, []), {})).toBe(false);
  });

  it("unreadCount räknar förfrågningar, inte meddelanden", () => {
    const items = [item(1, [["claude", "a"], ["ulrik", "b"]]), item(2, [["claude", "a"]]), item(3, [])];
    expect(unreadCount(items, { "2": "z" })).toBe(1);
  });

  it("sortForList: oläst, väntar på svar, pågående, avslutade — senaste aktivitet först inom grupp", () => {
    const at = (number: number, state: FeedbackItem["state"], createdAt: string, msgs: Array<["claude" | "ulrik" | "du", string]> = []): FeedbackItem =>
      ({ ...item(number, msgs), state, createdAt });
    const list = [
      at(1, "levererad", "2026-11-10T12:00:00Z"),
      at(2, "pagar", "2026-11-01T00:00:00Z"),
      at(3, "pagar", "2026-11-05T00:00:00Z"),
      at(4, "vantar_pa_dig", "2026-11-01T00:00:00Z", [["claude", "2026-11-02T00:00:00Z"]]),
      at(5, "undersokt", "2026-11-01T00:00:00Z", [["claude", "2026-11-03T00:00:00Z"]]),
      at(6, "avslutad", "2026-11-11T00:00:00Z"),
    ];
    const seen = { "4": "2026-11-09T00:00:00Z" };
    expect(sortForList(list, seen).map((i) => i.number)).toEqual([5, 4, 3, 2, 6, 1]);
  });

  it("isFinished och lastActivity", () => {
    expect(isFinished({ ...item(1, []), state: "levererad" })).toBe(true);
    expect(isFinished({ ...item(1, []), state: "pagar" })).toBe(false);
    expect(lastActivity({ ...item(1, []), createdAt: "c" })).toBe("c");
    expect(lastActivity(item(1, [["claude", "m"]]))).toBe("m");
  });

  it("messagesFrom utan kommentarer är tom", () => {
    expect(messagesFrom([], "u-1")).toEqual([]);
  });
});

describe("hjälpfunktioner", () => {
  it("neutralize tar bort omnämnanden och dolda kommentarer", () => {
    expect(neutralize("hej @bob <!-- x -->")).toBe("hej @​bob &lt;!-- x -->");
  });

  it("issueBody utan release skriver okänd och neutraliserar namn och webbläsare", () => {
    const body = issueBody({ ...INPUT, userAgent: "a`b\nc" }, { ...USER, name: "@evil" }, undefined, new Date("2026-11-09T10:00:00Z"));
    expect(body).toContain("**Release:** okänd");
    expect(body).toContain("**Från:** @​evil");
    expect(body).toContain("**Webbläsare:** abc");
  });

  it.each([
    [true, [], "mottagen"],
    [true, ["undersökt"], "undersokt"],
    [true, ["undersökt", "ej-bekräftad"], "ej_bekraftad"],
    // Ulriks beslut vinner över agentens bedömning — han kan verifiera ändå.
    [true, ["undersökt", "ej-bekräftad", "verifierad"], "verifierad"],
    [true, ["verifierad", "nedbruten"], "pagar"],
    [true, ["undersökt", "dubblett"], "dubblett"],
    [true, ["finns-redan"], "finns_redan"],
    // Användaren svarade "det hjälpte inte" och verifieringen frågar igen.
    [true, ["finns-redan", "väntar-på-användaren"], "vantar_pa_dig"],
    // En fråga som väntar går före — användaren ska svara.
    [true, ["dubblett", "väntar-på-användaren"], "vantar_pa_dig"],
    [false, ["dubblett", "levererad"], "levererad"],
    [false, ["nedbruten"], "avslutad"],
    [false, ["levererad"], "levererad"],
  ] as const)("feedbackState(open=%s, %j) = %s", (open, labels, expected) => {
    expect(feedbackState(open, labels)).toBe(expected);
  });

  it("releaseFromLabels", () => {
    expect(releaseFromLabels(["x", "release:v1.2.3"])).toBe("v1.2.3");
    expect(releaseFromLabels(["x"])).toBeNull();
  });
});
