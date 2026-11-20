/**
 * Test: FolderRow (mappraden i dokumentträdet) — raden är toppjusterad (#1753),
 * så att cellerna börjar längst upp när en cell bryts över flera rader.
 */

import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { FolderRow, type FolderRecord } from "@/components/documents/_folder-row";
import { asId } from "@/lib/shared/schemas/ids";

const folder: FolderRecord = {
  id: asId<"DocumentFolderId">("f-1"),
  name: "Inlagor",
  parentId: null,
  matterId: asId<"MatterId">("m-1"),
  createdAt: new Date("2026-03-01"),
};

function renderFolderRow() {
  return render(
    <table>
      <tbody>
        <FolderRow
          folder={folder} depth={0} isCollapsed={false} isDropTarget={false} isDragging={false}
          isRenaming={false} renameValue="" setRenameValue={vi.fn()} onToggle={vi.fn()}
          onDragStart={vi.fn()} onDragEnd={vi.fn()} onDragOver={vi.fn()} onDragLeave={vi.fn()} onDrop={vi.fn()}
          onRenameSubmit={vi.fn()} onRenameCancel={vi.fn()} onStartRename={vi.fn()} onDelete={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe("FolderRow", () => {
  it("raden är toppjusterad (#1753)", () => {
    const { getByText } = renderFolderRow();
    expect(getByText("Inlagor").closest("tr")).toHaveClass("align-top");
  });
});
