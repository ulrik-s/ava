/**
 * E2E (demo): jobbkön kör jobb i den ordning de köades (#1287).
 *
 * Buggen: kön tog det SENAST köade jobbet först. Tre Outlook-speglingar som
 * köades medan en annan körde gick till Graph som 1, 3, 2. En ändring och en
 * borttagning av samma event kunde då köras i fel ordning.
 *
 * Flödet i UI:t: Outlook "anslutet". Graph håller kvar den första
 * speglingen tills händelse 2 och 3 skapats (och köats bakom den), och
 * svarar sedan. Graph ska då ha fått dem i ordningen 1, 2, 3.
 */
import { createCalendarEvent, seedOutlookToken } from "./_calendar";
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("tre Outlook-speglingar når Graph i den ordning händelserna skapades", async ({ page }) => {
  const subjects: string[] = [];
  let releaseFirst = (): void => {};
  const firstHeld = new Promise<void>((r) => { releaseFirst = r; });
  // Registreras efter hermetik-vakten och vinner därför för Graph-origin.
  await page.route("https://graph.microsoft.com/**", async (route) => {
    // Speglingen slår först upp om händelsen redan finns i Outlook (#1361) — inget hittat.
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: [] }) });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    const subject = typeof body === "object" && body !== null && "subject" in body ? String(body.subject) : "?";
    subjects.push(subject);
    if (subjects.length === 1) await firstHeld;
    const t = { dateTime: "2026-10-01T09:00:00", timeZone: "UTC" };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: `g-${subjects.length}`, subject, start: t, end: t }) });
  });
  await seedOutlookToken(page);
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/calendar/`);
  await showPanel(page, "Kalender");

  await createCalendarEvent(page, { title: "FIFO 1", start: "2026-10-07T09:00", mirrorToOutlook: true });
  await expect.poll(() => subjects.length, { timeout: 15_000 }).toBe(1); // FIFO 1 kör och hålls kvar
  await createCalendarEvent(page, { title: "FIFO 2", start: "2026-10-07T10:00", mirrorToOutlook: true });
  await createCalendarEvent(page, { title: "FIFO 3", start: "2026-10-07T11:00", mirrorToOutlook: true });
  releaseFirst();

  await expect.poll(() => subjects.length, { timeout: 15_000 }).toBe(3);
  expect(subjects).toEqual(["FIFO 1", "FIFO 2", "FIFO 3"]);
});
