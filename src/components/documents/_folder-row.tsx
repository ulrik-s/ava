"use client";

import { Fragment, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  matterId: string;
  createdAt: string | Date;
}

interface Props {
  folder: FolderRecord;
  depth: number;
  isCollapsed: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  children?: ReactNode;
}

export function FolderRow({
  folder,
  depth,
  isCollapsed,
  isDropTarget,
  isDragging,
  isRenaming,
  renameValue,
  setRenameValue,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onRenameSubmit,
  onRenameCancel,
  onStartRename,
  onDelete,
  children,
}: Props) {
  return (
    <Fragment>
      <tr
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`hover:bg-gray-50 ${
          isDropTarget ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""
        } ${isDragging ? "opacity-50" : ""}`}
      >
        <td className="px-3 sm:px-6 py-2.5 text-sm">
          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
            <button onClick={onToggle} className="w-5 text-gray-400 hover:text-gray-600 flex-shrink-0 text-xs">
              {isCollapsed ? "▶" : "▼"}
            </button>
            {isRenaming ? (
              <form
                onSubmit={(e) => { e.preventDefault(); onRenameSubmit(); }}
                className="flex items-center gap-2 flex-1"
              >
                <span className="text-lg">📁</span>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  onBlur={onRenameCancel}
                  onKeyDown={(e) => { if (e.key === "Escape") onRenameCancel(); }}
                />
              </form>
            ) : (
              <button onClick={onToggle} className="flex items-center gap-2">
                <span className="text-lg">📁</span>
                <span className="font-medium text-gray-900">{folder.name}</span>
              </button>
            )}
          </div>
        </td>
        <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-400">&mdash;</td>
        <td className="hidden sm:table-cell px-6 py-2.5 text-sm text-gray-500 whitespace-nowrap">
          {new Date(folder.createdAt).toLocaleDateString("sv-SE")}
        </td>
        <td className="px-3 py-2.5 text-right">
          <ActionMenu
            label="Mappåtgärder"
            items={[
              { key: "rename", label: "Byt namn", icon: <Pencil size={15} />, onSelect: onStartRename },
              { key: "delete", label: "Ta bort", icon: <Trash2 size={15} />, onSelect: onDelete, danger: true },
            ] satisfies ActionMenuItem[]}
          />
        </td>
      </tr>
      {!isCollapsed && children}
    </Fragment>
  );
}
