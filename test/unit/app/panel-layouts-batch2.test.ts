/** Standardlayouter för batch 2 (#1184) — varje panel placeras exakt en gång. */
import { describe, expect, it } from "vitest-compat";
import { calendarLayout } from "@/app/calendar/_calendar-layout";
import { jobsLayout } from "@/app/jobs/_jobs-layout";
import { paymentImportLayout } from "@/app/payments/import/_import-layout";
import { profileLayout } from "@/app/profile/_profile-layout";
import { reportsLayout } from "@/app/reports/_reports-layout";
import { settingsLayout } from "@/app/settings/_settings-layout";
import type { AddPanel, DefaultLayout } from "@/components/layout/dock-workspace";

function record(layout: DefaultLayout, screen: "laptop" | "large") {
  const calls: Array<{ id: string; opts: Parameters<AddPanel>[1] }> = [];
  layout((id, opts) => { calls.push({ id, opts }); }, screen);
  return calls;
}

const CASES: Array<[string, DefaultLayout, string[]]> = [
  ["inställningar", settingsLayout, ["atgarder", "datasource", "external", "ledger", "offices", "org", "tags", "views"]],
  ["rapporter", reportsLayout, ["ar", "matters", "summary", "unbilled", "weekly"]],
  ["kalender", calendarLayout, ["calendar", "tasks", "users"]],
  ["jobbkö", jobsLayout, ["active", "history"]],
  ["profil", profileLayout, ["basics", "integrations"]],
  ["betalfilsimport", paymentImportLayout, ["file", "match", "receivables"]],
];

describe("standardlayouter, batch 2", () => {
  for (const [name, layout, ids] of CASES) {
    it.each(["laptop", "large"] as const)(`${name} (%s): varje panel exakt en gång`, (screen) => {
      expect(record(layout, screen).map((c) => c.id).sort()).toEqual(ids);
    });
  }

  it("kalendern: smal användarlista till vänster", () => {
    expect(record(calendarLayout, "laptop").find((c) => c.id === "users")?.opts).toEqual({
      position: { referencePanel: "calendar", direction: "left" }, initialWidth: 240,
    });
  });

  it("inställningar på stor skärm: tre kolumner", () => {
    expect(record(settingsLayout, "large").find((c) => c.id === "atgarder")?.opts?.position).toEqual({ referencePanel: "ledger", direction: "right" });
  });
});
