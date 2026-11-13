/**
 * Svar i kommentarer startar rätt agent direkt: användarens svar från AVA och
 * Ulriks svar på något blockerat. Agenternas egna kommentarer startar inget.
 */
import { describe, expect, it } from "vitest-compat";
import { commentTarget } from "../../tooling/scripts/flow/comments";
import type { FetchFn } from "../../tooling/scripts/flow/dispatch";
import { loadFlow } from "../../tooling/scripts/flow/load";
import { handleComment } from "../../tooling/scripts/flow-comment";

const flow = loadFlow();
const intake = flow.machines.intake;
const codePr = flow.machines["code-pr"];
if (!intake || !codePr) throw new Error("saknar maskiner");

const REPLY = "<!-- ava-user-reply:u-anna -->\nFaktura 7";

describe("commentTarget", () => {
  it("användarens svar: tillståndets agent, annars verifieringen", () => {
    expect(commentTarget(flow, intake, { body: REPLY, byUlrik: true, labels: ["user-request", "väntar-på-användaren"] })).toBe("L1");
    expect(commentTarget(flow, intake, { body: REPLY, byUlrik: true, labels: ["undersökt", "väntar-på-användaren"] })).toBe("L1");
    expect(commentTarget(flow, intake, { body: REPLY, byUlrik: true, labels: ["verifierad", "väntar-på-användaren"] })).toBe("L2");
  });

  it("Ulriks svar på något blockerat: tillståndets agent", () => {
    expect(commentTarget(flow, codePr, { body: "Kör på alternativ 2.", byUlrik: true, labels: ["agent-pr", "behöver-ändras", "blockerad"] })).toBe("L4");
  });

  it("i det publika kodrepot räknas inte markören — vem som helst kan skriva den", () => {
    expect(commentTarget(flow, codePr, { body: REPLY, byUlrik: false, labels: ["att-granska"] })).toBeNull();
  });

  it("agenternas kommentarer, eller Ulriks på något som inte är blockerat: inget", () => {
    expect(commentTarget(flow, codePr, { body: "Granskning …", byUlrik: false, labels: ["att-granska", "blockerad"] })).toBeNull();
    expect(commentTarget(flow, codePr, { body: "Snyggt!", byUlrik: true, labels: ["att-granska"] })).toBeNull();
  });
});

describe("handleComment", () => {
  const calls: string[] = [];
  const fetchFn: FetchFn = (url) => { calls.push(url); return Promise.resolve({ ok: true, status: 200 }); };
  const payload = (body: string, labels: string[], app: unknown = null) => ({
    repository: { full_name: "ulrik-s/ava-feedback" },
    issue: { number: 4, labels: labels.map((name) => ({ name })) },
    comment: { body, user: { login: "ulrik-s" }, performed_via_github_app: app },
  });

  it("startar verifieringen när användaren svarar", async () => {
    expect(await handleComment(flow, payload(REPLY, ["väntar-på-användaren"]), { ROUTINE_TOKEN_L1: "t" }, fetchFn, () => {})).toBe("L1");
    expect(calls.at(-1)).toContain("trig_01Pt8BjCQCZPnje4DXrTx4QU/fire");
  });

  it("utan token, eller en kommentar som inget ska starta: null", async () => {
    expect(await handleComment(flow, payload(REPLY, []), {}, fetchFn, () => {})).toBeNull();
    const lines: string[] = [];
    expect(await handleComment(flow, payload("Rapport", ["undersökt"], { slug: "claude" }), { ROUTINE_TOKEN_L1: "t" }, fetchFn, (l) => lines.push(l))).toBeNull();
    expect(lines[0]).toContain("startar ingen agent");
  });

  it("ett repo utan flöde: null", async () => {
    expect(await handleComment(flow, { ...payload(REPLY, []), repository: { full_name: "x/y" } }, {}, fetchFn, () => {})).toBeNull();
  });
});
