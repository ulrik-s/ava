"use client";

/**
 * `signGitCommit` — bygger en SSH-signerad git-commit och returnerar
 * dess OID. Använder isomorphic-git:s low-level API:er för att kringgå
 * att `git.commit()` bara stödjer OpenPGP-signering.
 *
 * Flow:
 *   1. Skriv staged-state till ett träd-objekt (writeTree)
 *   2. Bygg commit-textens "kanoniska" form (utan signatur)
 *   3. Signera den texten med SSHSIG
 *   4. Skapa NYTT commit-objekt med `gpgsig`-header (indenterad)
 *   5. Skriv det till git via writeObject
 *   6. Uppdatera HEAD så commit:n blir den nya HEAD
 */

import type { FsaIsoGitAdapter } from "@/lib/fsa/fs-adapter";
import { sshsigSign } from "./sshsig";

export interface SignCommitArgs {
  fs: FsaIsoGitAdapter;
  dir?: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** Råa Ed25519-pubkey:s 32 bytes — embeddas i SSHSIG. */
  publicKey: Uint8Array;
  /** WebCrypto-nyckeln som ska signera commit-texten. */
  privateKey: CryptoKey;
}

export async function signGitCommit(args: SignCommitArgs): Promise<string> {
  const dir = args.dir ?? "/";
  const git = await import("isomorphic-git");

  // 1. Skriv aktuellt index till tree-objekt
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = args.fs as any;
  const treeOid = await writeTreeFromIndex(git, fs, dir);

  // 2. Hämta nuvarande HEAD som parent (om finns)
  let parent: string | null = null;
  try {
    parent = await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    // Tomt repo — ingen parent
  }

  // 3. Bygg author + committer-tidsstämplar
  const now = Math.floor(Date.now() / 1000);
  const tz = "+0000"; // UTC för enkelhet — git tolererar
  const authorLine = `${args.authorName} <${args.authorEmail}> ${now} ${tz}`;

  // 4. Bygg den kanoniska commit-texten (utan signatur)
  // Det är DETTA vi signerar; sedan bygger vi ett separat commit-objekt
  // med gpgsig-header inlagd.
  const canonical = buildCommitText({
    tree: treeOid,
    parent,
    author: authorLine,
    committer: authorLine,
    message: args.message,
  });

  // 5. Signera den kanoniska texten med SSHSIG
  const messageBytes = new TextEncoder().encode(canonical);
  const signature = await sshsigSign({
    publicKey: args.publicKey,
    sign: async (data) => {
      const sig = await crypto.subtle.sign(
        "Ed25519",
        args.privateKey,
        data.buffer as ArrayBuffer,
      );
      return new Uint8Array(sig);
    },
    message: messageBytes,
  });

  // 6. Bygg det slutgiltiga commit-objektet med gpgsig-header.
  // git-format kräver att flerradade headers indenteras med ett
  // leading space på alla rader efter den första.
  const sigIndented = signature.split("\n").map((l, i) => i === 0 ? l : " " + l).join("\n");
  const signedText = buildCommitText({
    tree: treeOid,
    parent,
    author: authorLine,
    committer: authorLine,
    extraHeaders: [["gpgsig", sigIndented]],
    message: args.message,
  });

  // 7. Skriv objektet till git:s object database
  const oid = await git.writeObject({
    fs, dir,
    type: "commit",
    // isomorphic-git accepterar string för commit-objekt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    object: signedText as any,
    format: "content",
  });

  // 8. Uppdatera HEAD så commit:n blir HEAD
  await git.writeRef({ fs, dir, ref: "HEAD", value: oid, force: true });

  return oid;
}

interface CommitTextArgs {
  tree: string;
  parent: string | null;
  author: string;
  committer: string;
  extraHeaders?: Array<[string, string]>;
  message: string;
}

function buildCommitText(a: CommitTextArgs): string {
  const lines: string[] = [];
  lines.push(`tree ${a.tree}`);
  if (a.parent) lines.push(`parent ${a.parent}`);
  lines.push(`author ${a.author}`);
  lines.push(`committer ${a.committer}`);
  for (const [name, value] of a.extraHeaders ?? []) {
    lines.push(`${name} ${value}`);
  }
  lines.push("");
  lines.push(a.message);
  // git-objekt slutar med en newline
  return lines.join("\n") + (a.message.endsWith("\n") ? "" : "\n");
}

/**
 * isomorphic-git har ingen direkt `writeTree`-export. Vi använder
 * `add` + skriver tree från index via det interna API:t. För vår
 * användning ska working tree redan vara stagat innan vi kommer hit.
 *
 * Implementation: använd `git.writeTree()` om tillgängligt; annars
 * fall back till `git.commit({dryRun:true})` för att få tree-oid:n.
 */
async function writeTreeFromIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  git: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any,
  dir: string,
): Promise<string> {
  if (typeof git.writeTree === "function") {
    return git.writeTree({ fs, dir }) as Promise<string>;
  }
  // Fallback: kör en dry-run-commit för att få tree-oid:n
  const fakeCommit = await git.commit({
    fs, dir,
    message: "TEMP — will be discarded",
    author: { name: "tmp", email: "tmp@local" },
    dryRun: true,
  });
  // Sedan läs tree:n från det skapade commit-objektet
  const obj = await git.readObject({ fs, dir, oid: fakeCommit });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (obj.object as any).tree;
}
