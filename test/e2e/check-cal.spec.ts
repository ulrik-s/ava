import { test } from "@playwright/test";

test("intercept tRPC + window-stores", async ({ page }) => {
  await page.goto("https://ulrik-s.github.io/ava/calendar/");
  await page.waitForFunction(() => !document.body.innerText.includes("Laddar data"), { timeout: 30_000 });
  await page.waitForTimeout(2000);
  
  // Klicka alla user-knappar
  const items = await page.locator('button:has(input[type="checkbox"])').all();
  for (const item of items) await item.click().catch(() => {});
  await page.waitForTimeout(2000);
  
  // Försök hitta query-cache-state genom React DevTools-API:
  const cacheDump = await page.evaluate(() => {
    // Hitta tanstack-query-cache i React tree
    const root = document.querySelector('[id="__next"], #root, [class*="App"]') as HTMLElement;
    if (!root) return { error: "no root" };
    
    // Försöka få storarna via fetch-API direkt mot tRPC-link via window:
    // I demo-mode finns det INGEN HTTP-tRPC — alla anrop går in-process. 
    // Vi behöver injicera oss in i klient-callern.
    type W = Window & { __TRPC_CACHE__?: unknown };
    const w = window as W;
    return { 
      hasTrpcCache: !!w.__TRPC_CACHE__,
      url: location.href,
    };
  });
  console.log("Cache dump:", cacheDump);
  
  // Bara observera UI:n istället
  const main = await page.locator("main").textContent();
  console.log("Main innehåller 'Klientmöte':", main?.includes("Klientmöte"));
  console.log("Main innehåller 'Huvudförhandling':", main?.includes("Huvudförhandling"));
  
  // Lista som vy istället
  await page.getByRole("button", { name: "Lista" }).click().catch(() => {});
  await page.waitForTimeout(2000);
  const listMain = await page.locator("main").textContent();
  console.log("=== LISTA ===");
  console.log(listMain?.slice(0, 800));
});
