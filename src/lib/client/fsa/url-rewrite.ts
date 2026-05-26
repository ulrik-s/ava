/**
 * `sshToHttps` — översätter SSH-git-URL till HTTPS-motsvarighet.
 *
 * Behövs eftersom isomorphic-git inte stöder SSH-protokollet i
 * browser-kontext (inget native ssh-stack i webbläsare). När
 * användaren klonat via `git clone git@github.com:user/repo.git`
 * pekar `.git/config` på SSH-URL — vi översätter vid push/pull.
 *
 * Stöder:
 *   - git@host:path → https://host/path
 *   - ssh://git@host/path → https://host/path
 *   - https://… lämnas oförändrad
 */

export function sshToHttps(url: string): string {
  if (!url) return "";

  // ssh://git@host/path[.git]
  const sshScheme = url.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/);
  if (sshScheme) {
    const [, host, path] = sshScheme;
    return `https://${host}/${path}`;
  }

  // git@host:path[.git]  — notera kolon istället för slash efter host
  const scpLike = url.match(/^(?:[^@]+@)?([a-zA-Z0-9.\-_]+):(.+)$/);
  if (scpLike && !url.startsWith("http")) {
    const [, host, path] = scpLike;
    return `https://${host}/${path}`;
  }

  return url;
}
