/**
 * `demoStaticParams` — minimal generateStaticParams för demo-builden.
 *
 * Vi vill INTE pre-rendera HTML per seed-id (det skulle göra exporten
 * statisk-tung). Istället returnerar vi bara sentinel-shell:en så Next
 * får en (1) HTML-platshållare som chunk-ingång, och alla riktiga
 * URL:er router:as klientsidigt via SPA-fallback (404.html → app-shell).
 *
 * `SHELL_PARAM` används också av nginx i self-hosted-läget (try_files
 * fallback för godtyckliga entity-id:n i kundens git-klone).
 */

export const SHELL_PARAM = "__shell__";

export async function demoStaticParams(_pathPrefix: string): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  return [{ id: SHELL_PARAM }];
}

/**
 * Kvar för bakåt-kompat med eventuella callers; returnerar tom array
 * eftersom vi inte längre pre-renderar per seed-id.
 */
export async function collectDemoIds(_pathPrefix: string): Promise<string[]> {
  return [];
}
