/** Standardlayouter för sidor med få paneler (#1184) — varje panel placeras, i rätt kolumn. */
import { describe, expect, it } from "vitest-compat";
import { contactLayout } from "@/app/contacts/[id]/_contact-layout";
import { paymentPlanLayout } from "@/app/payment-plans/[id]/_payment-plan-layout";
import type { DefaultLayout } from "@/components/layout/dock-workspace";

function record(layout: DefaultLayout, screen: "laptop" | "large" = "laptop") {
  const calls: Array<{ id: string; ref?: unknown }> = [];
  layout((id, opts) => { calls.push({ id, ref: opts?.position }); }, screen);
  return calls;
}

describe("kontaktsidan", () => {
  it("uppgifter till vänster, ärenden + kontaktpersoner som flikar till höger", () => {
    expect(record(contactLayout)).toEqual([
      { id: "details", ref: undefined },
      { id: "matters", ref: { referencePanel: "details", direction: "right" } },
      { id: "people", ref: { referencePanel: "matters", direction: "within" } },
    ]);
  });
});

describe("avbetalningsplanen", () => {
  it("planen till vänster, inbetalningar över påminnelser till höger", () => {
    expect(record(paymentPlanLayout, "large")).toEqual([
      { id: "summary", ref: undefined },
      { id: "payments", ref: { referencePanel: "summary", direction: "right" } },
      { id: "reminders", ref: { referencePanel: "payments", direction: "below" } },
    ]);
  });
});
