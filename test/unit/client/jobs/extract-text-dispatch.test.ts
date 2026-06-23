/**
 * Tester för extract-text-dispatchern (#27 — otestad klientlogik).
 * Täcker: ingen dispatcher → kast, redan-abortad signal → kast, samt
 * att registrerad dispatcher anropas med args.
 */
import { describe, it, expect, vi, afterEach } from "vitest-compat";
import { setExtractTextDispatcher, dispatchExtractText } from "@/lib/client/jobs/extract-text-dispatch";
import { asId } from "@/lib/shared/schemas/ids";

afterEach(() => setExtractTextDispatcher(null));

describe("dispatchExtractText", () => {
  it("kastar när ingen dispatcher registrerats", async () => {
    setExtractTextDispatcher(null);
    await expect(dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "x" }))
      .rejects.toThrow(/Ingen extract-text-dispatcher/);
  });

  it("kastar 'Aborted' när signalen redan abortats", async () => {
    setExtractTextDispatcher(vi.fn(async () => {}));
    const ac = new AbortController();
    ac.abort();
    await expect(dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "x", signal: ac.signal }))
      .rejects.toThrow("Aborted");
  });

  it("anropar registrerad dispatcher med args", async () => {
    const fn = vi.fn(async () => {});
    setExtractTextDispatcher(fn);
    await dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "hej" });
    expect(fn).toHaveBeenCalledWith({ documentId: "d1", text: "hej" });
  });
});
