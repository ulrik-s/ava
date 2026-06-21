/**
 * OS-detektering — wrappar `process.platform` så per-OS-grenar går att
 * resonera om och testa via en enda normaliserad union.
 */

export type Platform = "darwin" | "linux" | "windows" | "other";

/** Ren mappning från Node:s plattforms-sträng → vår union (testbar). */
export function platformFrom(p: string): Platform {
  switch (p) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

export function currentPlatform(): Platform {
  return platformFrom(process.platform);
}
