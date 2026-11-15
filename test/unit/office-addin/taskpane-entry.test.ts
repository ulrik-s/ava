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
  it("renderar formuläret ur mallen och fyller i sparad server och PAT", async () => {
    const page = new DOMParser().parseFromString(HTML, "text/html");
    page.querySelectorAll("script").forEach((s) => s.remove()); // ingången importeras nedan i stället
    document.body.innerHTML = page.body.innerHTML;
    const office = installFakeOffice({
      item: DEFAULT_MAIL,
      restUrl: "https://outlook.office.com/api",
      callbackToken: "t",
      roaming: { ava_server: "https://ava.example", ava_pat: "ava_pat_x" },
    });
    globalThis.Office = office;

    await import("../../../office-addin/taskpane/taskpane");

    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    expect(document.getElementById("app")?.textContent).not.toContain("Laddar…");
    expect(input("server").value).toBe("https://ava.example");
    expect(input("pat").value).toBe("ava_pat_x");
    // Inget ärende valt än → Spara är avstängd.
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
  });
});
