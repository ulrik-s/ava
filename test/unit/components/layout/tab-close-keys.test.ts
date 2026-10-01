/**
 * Flikarna går inte att stänga med tangentbordet (#1356): dockview-core stänger
 * en fokuserad flik med Delete/Backspace trots `hideClose`.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { swallowTabCloseKey, type TabKeyEvent } from "@/components/layout/tab-close-keys";

function keyEvent(key: string, target: EventTarget | null): TabKeyEvent & { stopped: () => boolean } {
  const stopPropagation = vi.fn();
  const preventDefault = vi.fn();
  return {
    key, target, stopPropagation, preventDefault,
    stopped: () => stopPropagation.mock.calls.length > 0 && preventDefault.mock.calls.length > 0,
  };
}

const tab = (): HTMLElement => Object.assign(document.createElement("div"), { className: "dv-tab" });

describe("swallowTabCloseKey", () => {
  it.each(["Delete", "Backspace"])("%s på en flik stoppas innan dockview ser den", (key) => {
    const e = keyEvent(key, tab());
    swallowTabCloseKey(e);
    expect(e.stopped()).toBe(true);
  });

  it("andra tangenter på fliken passerar (piltangenter, Enter)", () => {
    for (const key of ["ArrowRight", "Enter", "Home"]) {
      const e = keyEvent(key, tab());
      swallowTabCloseKey(e);
      expect(e.stopped()).toBe(false);
    }
  });

  it("Backspace i ett fält i panelen passerar — där raderar den text", () => {
    const e = keyEvent("Backspace", document.createElement("input"));
    swallowTabCloseKey(e);
    expect(e.stopped()).toBe(false);
  });

  it("ett mål som inte är ett element passerar", () => {
    const e = keyEvent("Delete", null);
    swallowTabCloseKey(e);
    expect(e.stopped()).toBe(false);
  });
});
