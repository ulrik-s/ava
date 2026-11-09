/**
 * `feedback.submit` / `feedback.mine`: användarens text blir en issue i det
 * privata intag-repot med serverns kontext överst, användaren ser bara sina
 * egna förfrågningar, och ingen kan skicka mer än FEEDBACK_PER_HOUR i timmen.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import type { FeedbackIssue, IFeedbackSink } from "@/lib/server/ports";
import {
  feedbackRouter, FEEDBACK_PER_HOUR, issueBody, mineFrom, neutralize, ownerMarker, resetFeedbackRateLimit,
} from "@/lib/server/routers/feedback";
import { feedbackState, releaseFromLabels } from "@/lib/shared/feedback";
import { setLogSink, nullSink, type LogRecord } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

const USER = { id: asId<"UserId">("u-1"), email: "a@byra.se", name: "Anna", role: "LAWYER" as const, organizationId: asId<"OrganizationId">("org-1") };

function fakeSink(existing: FeedbackIssue[] = []) {
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const sink: IFeedbackSink = {
    create: (i) => { created.push(i); return Promise.resolve({ number: 41 + created.length }); },
    list: () => Promise.resolve(existing),
  };
  return { sink, created };
}

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
  const issue = (n: number, body: string, labels: string[], open = true): FeedbackIssue =>
    ({ number: n, title: `t${n}`, body, open, labels, createdAt: `2026-11-0${n}T10:00:00Z` });

  it("bara mina, nyast först, med status och release", async () => {
    const mine1 = issue(1, `${ownerMarker("u-1")}\n…`, ["user-request", "bugg", "godkänd"]);
    const mine2 = issue(2, `${ownerMarker("u-1")}\n…`, ["user-request", "förslag", "levererad", "release:v0.5.0"], false);
    const other = issue(3, `${ownerMarker("u-2")}\n…`, ["user-request"]);
    // Någon klistrar in min markör i sin text — räknas inte, markören måste stå först.
    const forged = issue(4, `${ownerMarker("u-2")}\n> ${ownerMarker("u-1")}`, ["user-request"]);
    const items = await caller(fakeSink([mine1, mine2, other, forged]).sink).mine();
    expect(items.map((i) => [i.number, i.kind, i.state, i.release])).toEqual([
      [2, "feature", "levererad", "v0.5.0"],
      [1, "bug", "godkand", null],
    ]);
  });

  it("mineFrom är tom när inget matchar", () => {
    expect(mineFrom([], "u-1")).toEqual([]);
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
    [true, ["godkänd"], "godkand"],
    [true, ["godkänd", "nedbruten"], "pagar"],
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
