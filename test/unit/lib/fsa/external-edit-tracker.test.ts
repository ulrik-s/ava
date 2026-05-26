/**
 * Tester för `ExternalEditTracker` — pollar `lastModified` på en fil
 * och triggar en commit-callback EFTER en debounce-paus där inga
 * fler ändringar skett.
 *
 * Bevisar:
 *   1. Första ändringen startar en edit-session.
 *   2. Flera nära varandra-sparningar squashas till EN commit.
 *   3. Commit-callback får slutbytes + antal "saves" inom session.
 *   4. "Spara nu"-trigger kan tvinga commit innan debounce gått ut.
 *   5. Polling stoppas när tracker:n disposas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExternalEditTracker } from "@/lib/client/fsa/external-edit-tracker";

// Minimal FileSystemFileHandle-fake: vi mutar `lastModified` mellan ticks.
class FakeHandle {
  private bytes: Uint8Array;
  private lastModified: number;
  constructor(initialBytes: Uint8Array, lastModified: number) {
    this.bytes = initialBytes;
    this.lastModified = lastModified;
  }
  setSave(newBytes: Uint8Array, lastModified: number): void {
    this.bytes = newBytes;
    this.lastModified = lastModified;
  }
   
  async getFile(): Promise<{ lastModified: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
    const bytes = this.bytes;
    return {
      lastModified: this.lastModified,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("ExternalEditTracker", () => {
  it("ignorerar lastModified-värdet vid mount (= baseline)", async () => {
    const handle = new FakeHandle(new Uint8Array([1, 2]), 1000);
    const onCommit = vi.fn();
    const tracker = new ExternalEditTracker({ pollIntervalMs: 100, debounceMs: 500, onCommit });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    // Inga ändringar → ingen commit
    await vi.advanceTimersByTimeAsync(2000);
    expect(onCommit).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it("commit:ar efter debounce när lastModified ändrats en gång", async () => {
    const handle = new FakeHandle(new Uint8Array([1]), 1000);
    const onCommit = vi.fn();
    const tracker = new ExternalEditTracker({ pollIntervalMs: 50, debounceMs: 300, onCommit });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    handle.setSave(new Uint8Array([2]), 2000);
    await vi.advanceTimersByTimeAsync(100);  // poll detekterar
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);  // debounce-fönstret löper ut
    expect(onCommit).toHaveBeenCalledTimes(1);
    const arg = onCommit.mock.calls[0][0];
    expect(arg.docId).toBe("doc-1");
    expect(arg.saves).toBe(1);
    expect(Array.from(new Uint8Array(arg.bytes))).toEqual([2]);

    tracker.dispose();
  });

  it("squashar flera nära varandra-sparningar till EN commit", async () => {
    const handle = new FakeHandle(new Uint8Array([1]), 1000);
    const onCommit = vi.fn();
    const tracker = new ExternalEditTracker({ pollIntervalMs: 50, debounceMs: 300, onCommit });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    handle.setSave(new Uint8Array([2]), 2000);
    await vi.advanceTimersByTimeAsync(100);
    handle.setSave(new Uint8Array([3]), 2100);
    await vi.advanceTimersByTimeAsync(100);
    handle.setSave(new Uint8Array([4]), 2200);
    await vi.advanceTimersByTimeAsync(100);

    // Ännu inom debounce-fönstret → ingen commit
    expect(onCommit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].saves).toBe(3);
    expect(Array.from(new Uint8Array(onCommit.mock.calls[0][0].bytes))).toEqual([4]);

    tracker.dispose();
  });

  it("flushNow() forcerar commit av pågående session direkt", async () => {
    const handle = new FakeHandle(new Uint8Array([1]), 1000);
    const onCommit = vi.fn();
    const tracker = new ExternalEditTracker({ pollIntervalMs: 50, debounceMs: 10_000, onCommit });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    handle.setSave(new Uint8Array([2]), 2000);
    await vi.advanceTimersByTimeAsync(100);
    await tracker.flushNow("doc-1");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].saves).toBe(1);
    tracker.dispose();
  });

  it("getSession() returnerar pågående edit-session-info för UI", async () => {
    const handle = new FakeHandle(new Uint8Array([1]), 1000);
    const tracker = new ExternalEditTracker({ pollIntervalMs: 50, debounceMs: 500, onCommit: vi.fn() });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    expect(tracker.getSession("doc-1")).toBeNull();

    handle.setSave(new Uint8Array([2]), 2000);
    await vi.advanceTimersByTimeAsync(100);

    const session = tracker.getSession("doc-1");
    expect(session?.saves).toBe(1);
    expect(session?.docId).toBe("doc-1");
    tracker.dispose();
  });

  it("dispose() stoppar polling", async () => {
    const handle = new FakeHandle(new Uint8Array([1]), 1000);
    const onCommit = vi.fn();
    const tracker = new ExternalEditTracker({ pollIntervalMs: 50, debounceMs: 200, onCommit });
    await tracker.watch({ docId: "doc-1", path: "a.pdf", handle: handle as never });

    tracker.dispose();
    handle.setSave(new Uint8Array([2]), 2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(onCommit).not.toHaveBeenCalled();
  });
});
