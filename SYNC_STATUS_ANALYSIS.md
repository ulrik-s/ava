# Document Browser Sync Status Badge Analysis

## 1. DocumentBrowser Component
**File:** `/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/src/components/documents/document-browser.tsx`

### How it fetches documents:
- Line 47: `const tree = trpc.document.tree.useQuery({ matterId });`
- Lines 52-54: Documents extracted from tree response:
  ```tsx
  const documents = useMemo<DocumentRecord[]>(
    () => tree.data?.documents ?? [],
    [tree.data],
  );
  ```

### How rows are rendered:

**Tree View (lines 149-167):**
```tsx
const renderDocRow = (doc: DocumentRecord, depth: number) => (
  <DocumentRow
    key={doc.id}
    doc={doc}
    depth={depth}
    isDragging={dragItem?.id === doc.id}
    isAnalyzing={analyzingIds.has(doc.id)}
    isUploading={uploadingIds.has(doc.id)}
    onDragStart={handleDragStart("document", doc.id)}
    onDragEnd={handleDragEnd}
    onReanalyze={() => mutations.reanalyze.mutate({ documentId: doc.id })}
    onDelete={() => {
      if (confirm(`Ta bort "${doc.fileName}"?`)) {
        mutations.deleteDocument.mutate({ id: doc.id });
      }
    }}
    reanalyzePending={mutations.reanalyze.isPending}
  />
);
```

The tree recursively renders via `DocumentTree` (lines 132-220):
- `renderFolderRow` renders `FolderRow` with child folders/docs (lines 169-206)
- Root folders/docs are in `BrowserTable` (line 208-219)

**List View (lines 119-126):**
```tsx
<DocumentsListView
  matterId={matterId}
  documents={documents}
  folders={folders}
  onDelete={(id) => mutations.deleteDocument.mutate({ id })}
  onReanalyze={(id) => mutations.reanalyze.mutate({ documentId: id })}
/>
```

### Where to thread sync-status:

**Best location:** Add `useHelperSyncStatus()` hook at DocumentBrowser component level (around line 46):
```tsx
const syncStatus = useHelperSyncStatus(); // New line
```

Then build a per-document sync-status map:
```tsx
const docSyncStatusMap = useMemo(() => {
  if (!syncStatus) return new Map<string, HelperSyncEntry>();
  const map = new Map<string, HelperSyncEntry>();
  for (const entry of syncStatus.entries) {
    if (entry.document?.id) {
      map.set(entry.document.id, entry);
    }
  }
  return map;
}, [syncStatus]);
```

Then pass to both view modes:
- **Tree View:** Add `docSyncStatusMap={docSyncStatusMap}` to `DocumentTree` component, thread through `renderDocRow`
- **List View:** Pass `docSyncStatusMap={docSyncStatusMap}` to `DocumentsListView`

---

## 2. DocumentRow Component  
**File:** `/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/src/components/documents/_document-row.tsx`

### Props (lines 33-46):
```tsx
interface Props {
  doc: DocumentRecord;
  depth: number;
  isDragging: boolean;
  isAnalyzing: boolean;
  /** Sätts till true under upload-fasen (FSA-write + register +
   *  tree-invalidate). Klick/öppna är disabled tills false. */
  isUploading?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  reanalyzePending: boolean;
}
```

### Existing "Lokal" badge (lines 96-103):
```tsx
{isUploading && (
  <span
    className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
    title="Sparas lokalt — pushas till git när auto-sync kör"
  >
    <span className="animate-pulse">●</span> Lokal
  </span>
)}
```

### DocumentRecord type (lines 13-31):
```tsx
export interface DocumentRecord {
  id: string;                           // ✓ Has id
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  version: number;
  matterId: string;
  folderId?: string | null | undefined;
  uploadedById: string;
  createdAt: string | Date;
  uploadedBy: { name: string | null } | null;
  title?: string | null | undefined;
  documentType?: string | null | undefined;
  tags?: readonly string[] | undefined;
  summary?: string | null | undefined;
  analyzedAt?: string | Date | null | undefined;
  analysisError?: string | null | undefined;
}
```

### To add sync-status badge:

**Add prop to DocumentRow:**
```tsx
syncEntry?: HelperSyncEntry | undefined;
```

**In render, after isUploading badge (line ~104):**
```tsx
{syncEntry && (
  syncEntry.status === 'conflict' ? (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-800"
      title={syncEntry.lastError || "Servern har en nyare version — öppna och spara igen"}
    >
      ⚠️ Konflikt
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"
      title="Ändringar väntar på synk till servern"
    >
      <span className="animate-pulse">☁️</span> Ändringar på ingång
    </span>
  )
)}
```

---

## 3. DocumentsListView
**File:** `/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/src/components/documents/_documents-list-view.tsx`

### Current Props (lines 21-27):
```tsx
interface Props {
  matterId: string;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  onDelete: (id: string) => void;
  onReanalyze: (id: string) => void;
}
```

### Column structure (lines 44-84):
Currently renders: fileName, documentType, folder, uploadedBy, createdAt, sizeBytes, actions.

**No per-row status badges currently.** The view delegates to kebab-menu actions only.

### To add sync-status column:

**Add prop:**
```tsx
docSyncStatusMap: Map<string, HelperSyncEntry>;
```

**Add column (after documentType, before folder):**
```tsx
{ key: "syncStatus", label: "Synk-status", sortable: false,
  render: (d) => {
    const entry = docSyncStatusMap.get(d.id);
    if (!entry) return null;
    return entry.status === 'conflict' ? (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-800">
        ⚠️ Konflikt
      </span>
    ) : (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
        ☁️ Ändringar på ingång
      </span>
    );
  },
},
```

---

## 4. useHelperSyncStatus Hook
**File:** `/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/src/lib/client/helper/use-helper.ts`

### Hook signature (lines 165-185):
```tsx
export function useHelperSyncStatus(intervalMs = 5_000): HelperStatusResponse | null {
  const [sync, setSync] = useState<HelperStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      const s = await fetchHelperStatus();
      if (cancelled) return;
      setSync(s);
      timer = setTimeout(() => void poll(), intervalMs);
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return sync;
}
```

**Returns:** `HelperStatusResponse | null` (null until first poll, or if helper unavailable)

### HelperStatusResponse shape (lines 167-176 of protocol.ts):
```tsx
export interface HelperStatusResponse {
  /** Antal poster som väntar/retr:as. */
  pending: number;
  /** Antal poster i versions-konflikt (kräver beslut). */
  conflict: number;
  /** Totalt antal poster i kön. */
  total: number;
  /** Posterna (utan authHeaders). */
  entries: HelperSyncEntry[];
}
```

### HelperSyncEntry shape (lines 141-160 of protocol.ts):
```tsx
export interface HelperSyncEntry {
  /** Stabilt id i kö-katalogen. */
  id: string;
  /** Server-tier upload-mål: tRPC `document.uploadContent` (ADR 0031). */
  document?: HelperDocumentRef;
  /** Demo/legacy PUT-mål. Exakt en av `document`/`uploadUrl` anges. */
  uploadUrl?: string;
  /** Användarsynligt filnamn. */
  fileName: string;
  /** När den först köades (ms sedan epoch). */
  enqueuedAt: number;
  /** Antal misslyckade upload-försök hittills. */
  attempts: number;
  /** Tidigast nästa försök (ms) — backoff. */
  nextAttemptAt: number;
  /** `pending` = väntar/retr:as; `conflict` = server gått förbi, kräver beslut. */
  status: "pending" | "conflict";
  /** Senaste felet (om något). */
  lastError?: string;
}
```

### HelperDocumentRef (lines 40-45 of protocol.ts):
```tsx
export interface HelperDocumentRef {
  /** Dokumentets id (input till `document.downloadContent`/`uploadContent`). */
  id: string;
  /** Serverns tRPC-endpoint, t.ex. `http://localhost:8080/api/trpc`. */
  trpcUrl: string;
}
```

**Current usage:** Only in `src/components/settings/helper-section.tsx` (lines 57-81)

---

## 5. HelperSection Component
**File:** `/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/src/components/settings/helper-section.tsx`

### Current sync-status rendering (lines 56-81):
```tsx
function SyncStatus() {
  const sync = useHelperSyncStatus();
  if (sync === null) return null;
  if (sync.conflict > 0) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 text-sm text-amber-700">
        <AlertTriangle size={14} />
        <span>{sync.conflict} dokument i konflikt — servern har en nyare version. Öppna och spara igen för att lösa.</span>
      </div>
    );
  }
  if (sync.pending > 0) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 text-sm text-blue-700">
        <CloudUpload size={14} />
        <span>{sync.pending} {sync.pending === 1 ? "ändring väntar" : "ändringar väntar"} på synk — sparas så fort servern går att nå.</span>
      </div>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-2 text-sm text-green-700">
      <CloudCheck size={14} />
      <span>Allt synkat — inga väntande ändringar.</span>
    </div>
  );
}
```

**ADR 0028 §8** is referenced: per-document sync-status is already exposed via `GET /status` → `HelperStatusResponse.entries[]`.

---

## 6. Test Coverage

### Test files:
1. **`/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/test/unit/components/helper-section.test.tsx`** (lines 1-93)
   - Tests for HelperSection component
   - Covers installation status, sync-status display, conflict/pending/synced states
   - Lines 66-92: Specific sync-status tests (pending count, conflict warning, döljs utan helper)

2. **`/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/test/unit/components/document-row-upload-guard.test.tsx`** (lines 1-128)
   - Tests DocumentRow badge rendering + disabled state
   - Lines 96-103: "Lokal" badge JSX pattern reference
   - No per-document sync-status tests (would need adding)

3. **`/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/test/unit/components/document-browser.test.tsx`** (lines 1-100+)
   - Tests tree rendering, folder operations
   - No sync-status tests (would need adding)

4. **`/Users/ulrik/src/ava/.claude/worktrees/adr-0012-fakturanummerserier/test/unit/components/documents-list-view.test.tsx`** (lines 1-109)
   - Tests list rendering, columns, folder paths
   - No sync-status tests (would need adding)

### Recommendation:
- Add test for DocumentRow with `syncEntry` prop:
  - Test "ändringar på ingång" badge renders when `syncEntry.status === 'pending'`
  - Test "⚠️ Konflikt" badge renders when `syncEntry.status === 'conflict'`
  - Test badge doesn't render when `syncEntry` is undefined/null

- Add DocumentBrowser test:
  - Verify `useHelperSyncStatus()` is called
  - Verify `docSyncStatusMap` is built correctly from entries
  - Verify map is threaded to both tree and list views

---

## Summary: Integration Checklist

1. **DocumentBrowser** (`document-browser.tsx`):
   - [ ] Add `useHelperSyncStatus()` hook call
   - [ ] Build `docSyncStatusMap` from `syncStatus.entries[]`
   - [ ] Thread map to `DocumentTree` via new prop
   - [ ] Thread map to `DocumentsListView` via new prop

2. **DocumentRow** (`_document-row.tsx`):
   - [ ] Add `syncEntry?: HelperSyncEntry` prop
   - [ ] Add badge JSX (after "Lokal" badge) for "ändringar på ingång" / "⚠️ Konflikt"
   - [ ] Mirror styling from existing "Lokal" badge (amber-100/amber-800, blue-100/blue-700 or red-100/red-800)

3. **DocumentsListView** (`_documents-list-view.tsx`):
   - [ ] Add `docSyncStatusMap: Map<string, HelperSyncEntry>` prop
   - [ ] Add optional sync-status column (or integrate into existing columns)

4. **Tests:**
   - [ ] Add DocumentRow sync-status badge tests
   - [ ] Add DocumentBrowser sync-status integration tests
   - [ ] Add DocumentsListView sync-status column tests

