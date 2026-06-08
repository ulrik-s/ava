/**
 * OS-detektering — wrappar `process.platform` så per-OS-grenar går att
 * resonera om och testa via en enda normaliserad union.
 */

export type Platform = "darwin" | "linux" | "windows" | "other";

export function currentPlatform(): Platform {
  switch (process.platform) {
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
