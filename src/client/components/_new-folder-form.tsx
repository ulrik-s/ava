"use client";

import { useState } from "react";

interface Props {
  isPending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function NewFolderForm({ isPending, onSubmit, onCancel }: Props) {
  const [name, setName] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
      className="px-6 py-3 border-b border-gray-100 flex items-center gap-2"
    >
      <span className="text-lg">📁</span>
      <input
        type="text"
        autoFocus
        required
        placeholder="Mappnamn..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        Skapa
      </button>
      <button
        type="button"
        onClick={() => { setName(""); onCancel(); }}
        className="px-3 py-1.5 text-sm text-gray-600 hover:underline"
      >
        Avbryt
      </button>
    </form>
  );
}
