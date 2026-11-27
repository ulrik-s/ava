"use client";

/**
 * Flytta dokument till ett annat ärende och en mapp där (#2045).
 * `MoveToMatterDialog` (#2043) med fältet **Mapp** (`FolderSelect`, #1974) över
 * målärendets mappar, och anropet `document.moveToMatter`. Tar dokumentens id,
 * så att markeringen av flera dokument (#2046) använder samma dialog. Ny fil,
 * så den skrivs med den nya tRPC-bindningen (`useTRPC`, ADR 0041).
 */

import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { MoveToMatterDialog } from "@/components/matter/move-to-matter-dialog";
import { useTRPC } from "@/lib/client/trpc";
import { documentMoveBlock, type MovableDocumentFields } from "@/lib/shared/document-move";
import type { DocumentFolderId, DocumentId, MatterId } from "@/lib/shared/schemas/ids";
import { FolderSelect } from "./folder-select";

/** Titeln på dokumentmenyns rader medan dokumentet laddas upp. */
export const UPLOADING_TITLE = "Vänta tills uppladdningen är klar";

/**
 * Varför dokumentet inte kan flyttas just nu, eller `null` om det kan det:
 * fakturans och kostnadsräkningens egna dokument (samma regel som servern) och
 * dokument som laddas upp.
 */
export function documentMoveDisabledReason(doc: MovableDocumentFields, isUploading: boolean): string | null {
  return isUploading ? UPLOADING_TITLE : documentMoveBlock(doc);
}

interface Props {
  /** Dokumenten som flyttas. */
  ids: readonly DocumentId[];
  /** Ärendet de ligger i: inte valbart. */
  excludeMatterId?: MatterId | undefined;
  open: boolean;
  onClose: () => void;
  /** Flytten gick igenom (t.ex. töm en markering). */
  onMoved?: (() => void) | undefined;
}

/** Målärendets mappar, när ett ärende är valt. */
function useTargetFolders(matterId: MatterId | "") {
  const t = useTRPC();
  const tree = useQuery(t.document.tree.queryOptions(matterId === "" ? skipToken : { matterId }));
  return tree.data?.folders ?? [];
}

/** Dialogen **Flytta till ärende** för dokument, med mappfältet under ärendet. */
export function MoveDocumentsDialog({ ids, excludeMatterId, open, onClose, onMoved }: Props) {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const folderFieldId = useId();
  const [matterId, setMatterId] = useState<MatterId | "">("");
  const [folderId, setFolderId] = useState<DocumentFolderId | null>(null);
  const folders = useTargetFolders(matterId);
  const move = useMutation(t.document.moveToMatter.mutationOptions({
    onSuccess: () => {
      // Som efter en ändring av dokumentet: listorna i båda ärendena läses om.
      void queryClient.invalidateQueries(t.document.pathFilter());
      onMoved?.();
      onClose();
    },
  }));
  const chooseMatter = (id: MatterId): void => { setMatterId(id); setFolderId(null); };
  const onMove = (target: MatterId): void => move.mutate({ ids: [...ids], matterId: target, folderId });
  return (
    <MoveToMatterDialog open={open} onClose={onClose} count={ids.length} noun="dokument"
      excludeMatterId={excludeMatterId} onMove={onMove} onMatterChange={chooseMatter}
      isPending={move.isPending} error={move.error?.message}>
      {matterId !== "" && (
        <div>
          <label htmlFor={folderFieldId} className="block text-sm font-medium text-gray-700 mb-1">Mapp</label>
          <FolderSelect id={folderFieldId} folders={folders} value={folderId} onChange={setFolderId} />
        </div>
      )}
    </MoveToMatterDialog>
  );
}
