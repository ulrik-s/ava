/**
 * `MoveToMatterDialog` (#2043) — flytta något till ett annat ärende: texten med
 * antal och substantiv, det nuvarande ärendet inte valbart, **Flytta** kräver
 * ett ärende, och fält under ärendet via `children`.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import { MoveToMatterDialog, type MoveToMatterDialogProps } from "@/components/matter/move-to-matter-dialog";
import { asId } from "@/lib/shared/schemas/ids";

const MATTERS = [
  { id: asId<"MatterId">("m1"), matterNumber: "2026-0001", title: "Vårdnad" },
  { id: asId<"MatterId">("m2"), matterNumber: "2026-0002", title: "Arvskifte" },
];

function renderDialog(over: Partial<MoveToMatterDialogProps> = {}) {
  const props: MoveToMatterDialogProps = {
    open: true, onClose: vi.fn(), count: 3, noun: "tidsposter", matters: MATTERS, onMove: vi.fn(), ...over,
  };
  const view = render(<MoveToMatterDialog {...props} />);
  return { ...view, props };
}

const matterInput = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>("3 tidsposter flyttas till:");
const options = (container: HTMLElement): string[] =>
  Array.from(container.ownerDocument.querySelectorAll("datalist option")).map((o) => o.getAttribute("value") ?? "");

describe("MoveToMatterDialog", () => {
  it("visar antal och substantiv, och alla ärenden utan excludeMatterId", () => {
    const { container } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Flytta till ärende" })).toBeInTheDocument();
    expect(matterInput()).toBeInTheDocument();
    expect(options(container)).toEqual(["2026-0001 — Vårdnad", "2026-0002 — Arvskifte"]);
  });

  it("excludeMatterId finns inte bland valen", () => {
    const { container } = renderDialog({ excludeMatterId: asId<"MatterId">("m1") });
    expect(options(container)).toEqual(["2026-0002 — Arvskifte"]);
  });

  it("Flytta kräver ett valt ärende och ger onMove med dess id", () => {
    const { props } = renderDialog();
    const flytta = screen.getByRole<HTMLButtonElement>("button", { name: "Flytta" });
    expect(flytta.disabled).toBe(true);
    fireEvent.submit(flytta.closest("form") as HTMLFormElement);
    expect(props.onMove).not.toHaveBeenCalled();
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    expect(flytta.disabled).toBe(false);
    fireEvent.click(flytta);
    expect(props.onMove).toHaveBeenCalledWith("m2");
  });

  it("Flytta är avstängd medan flytten pågår, och ett fel visas", () => {
    renderDialog({ isPending: true, error: "posten är låst" });
    fireEvent.change(matterInput(), { target: { value: "2026-0001 — Vårdnad" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Flytta" }).disabled).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Kunde inte flytta: posten är låst");
  });

  it("children visas under ärendet", () => {
    renderDialog({ children: <label>Mapp<input /></label> });
    expect(screen.getByLabelText("Mapp")).toBeInTheDocument();
  });

  it("Avbryt stänger och glömmer valet", () => {
    const { props, rerender } = renderDialog();
    fireEvent.change(matterInput(), { target: { value: "2026-0002 — Arvskifte" } });
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    rerender(<MoveToMatterDialog {...props} />);
    expect(matterInput().value).toBe("");
  });

  it("stängd: renderar inget", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
