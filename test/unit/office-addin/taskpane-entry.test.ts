/**
 * Ingången `office-addin/taskpane/taskpane.ts` mot den RIKTIGA task-panens
 * HTML och den delade fake-Office:n: `Office.onReady` → formuläret renderas
 * ur `#form-tpl` och sparade uppgifter fylls i.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import { DEFAULT_MAIL, installFakeOffice } from "../../helpers/office-fake";

const HTML = readFileSync(join(import.meta.dir, "..", "..", "..", "office-addin", "taskpane", "taskpane.html"), "utf8");

describe("task-panens ingång", () => {
  it("läser window.AVA_ADDIN, loggar in och renderar formuläret ur mallen", async () => {
    const page = new DOMParser().parseFromString(HTML, "text/html");
    page.querySelectorAll("script").forEach((s) => s.remove()); // ingången importeras nedan i stället
    document.body.innerHTML = page.body.innerHTML;
    globalThis.Office = installFakeOffice({ item: DEFAULT_MAIL });
    window.AVA_ADDIN = { clientId: "c", tenantId: "t", staticTokens: { ava: "a", graph: "g", name: "Maria Grosskopf" } };

    await import("../../../office-addin/taskpane/taskpane");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("app")?.textContent).not.toContain("Laddar…");
    expect(document.getElementById("who")?.textContent).toBe("Inloggad som Maria Grosskopf");
    // Inget ärende valt än → Spara är avstängd.
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
  });
});
