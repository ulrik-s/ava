import { test } from "@playwright/test";

test("kostnadsräkning generera m-016", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 300)); });
  // Tillåt popups (window.open i generate)
  page.context().on("page", () => {});

  await page.goto("https://ulrik-s.github.io/ava/matters/m-016-brottmal-rh/");
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: /Kostnadsräkning till rätten/ }).first().click();
  await page.waitForTimeout(1500);

  // STOPPA NU
  const stoppa = page.getByRole("button", { name: /STOPPA/ });
  if (await stoppa.count() > 0) await stoppa.first().click();
  await page.waitForTimeout(500);

  // Generera
  const gen = page.getByRole("button", { name: /Generera/ });
  console.log("Generera-knapp:", await gen.count());
  if (await gen.count() > 0) {
    await gen.first().click();
    await page.waitForTimeout(2500);
  }
  const body = await page.locator("body").textContent();
  console.log("Fel-text i modal:", /[Ff]el|kunde inte|misslyckades/.test(body ?? "") );
  console.log("=== ERRORS ===");
  errors.slice(0, 10).forEach(e => console.log(e));
});
