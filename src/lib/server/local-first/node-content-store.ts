/**
 * `NodeContentStore` — `IContentStore`-impl för server-runtime:n (git-peer).
 *
 * Skriver dokument-binärinnehåll in i git-working-copy:n på disk (samma
 * katalog som entitets-projektionerna), så `commit()` efter mutationen tar
 * med bytes:en och push:ar dem. Detta är server-spegeln av klientens
 * FSA-write (`uploadDocumentToFsa`): native-klienter (Office-add-in, #72)
 * kan inte nå filsystemet, så de POST:ar bytes:en över tRPC och servern
 * persisterar dem här.
 *
 * Path-traversal: vi delegerar till {@link NodeFileSystem}, vars `resolveSafe`
 * avvisar paths utanför roten. `storagePath` kommer (delvis) från klient-data
 * → skyddet är icke-förhandlingsbart.
 */

import type { IContentStore } from "../ports";
import { NodeFileSystem } from "./node-fs";

export class NodeContentStore implements IContentStore {
  private readonly fs: NodeFileSystem;

  constructor(dir: string) {
    this.fs = new NodeFileSystem(dir);
  }

  write(storagePath: string, bytes: Uint8Array): Promise<void> {
    // Strippa ev. ledande "/" (isomorphic-git-konventionen använder
    // "/"-prefixade repo-relativa paths; NodeFileSystem är root-sandboxad).
    return this.fs.writeFileBytes(storagePath.replace(/^\/+/, ""), bytes);
  }
}
