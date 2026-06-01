/**
 * `demoCacheKey` — OPFS-cache-nyckel för demo-slaben, versionerad per deploy.
 *
 * `NEXT_PUBLIC_DEMO_VERSION` sätts av deploy-demo.yml (= commit-sha) → varje ny
 * deploy får en ny namespace → `restoreFromCache` hittar inget gammalt →
 * `loadDemo` hämtar färsk seed-data (version-busting). Lokalt (utan version) en
 * stabil nyckel så slaben överlever reloads.
 *
 * Delas av `DemoBootstrap` (persist/restore av slaben) och `DemoModeBanner`
 * ("Återställ demo" → clear av samma nyckel).
 */
export function demoCacheKey(): string {
  const v = process.env.NEXT_PUBLIC_DEMO_VERSION;
  return v ? `ava-demo-${v.slice(0, 12)}` : "ava-demo";
}
