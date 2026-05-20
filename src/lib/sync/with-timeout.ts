/**
 * `withTimeout` — kör en Promise med hård timeout. Om operationen
 * inte resolverat inom `ms` millisekunder så rejectar wrapper:n med
 * `SyncTimeoutError`.
 *
 * Detta är *kritiskt* för auto-sync: nätoperationer mot GitHub eller
 * en hängande git-server får aldrig blockera UI:n eller köras i
 * evighet i bakgrunden. En timeout sätter en hård bortre gräns.
 *
 * Originalpromisen lever vidare i bakgrunden tills den själv ger upp
 * (vi har ingen riktig avbrytmekanism i isomorphic-git eller Tauri:s
 * libgit2-bindning), men `withTimeout` returnerar omedelbart en
 * rejection så att consumern kan fortsätta.
 */

export class SyncTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: timeout efter ${ms} ms`);
    this.name = "SyncTimeoutError";
  }
}

export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new SyncTimeoutError(label, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
