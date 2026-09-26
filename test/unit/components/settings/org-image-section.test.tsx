/**
 * OrgImageSection (#1218) — ladda upp / byt / ta bort byråns logga och
 * sidfotsmärke. Bilden valideras i webbläsaren (PNG/JPEG ≤ 300 kB). Syntetiska bilder.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { OrgImageSection, readFileAsDataUrl } from "@/components/settings/org-image-section";
import { TINY_PNG, TINY_PNG_BYTES } from "../../../helpers/tiny-images";

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!(el instanceof HTMLInputElement)) throw new Error("ingen filväljare");
  return el;
}

const RealFileReader = globalThis.FileReader;
afterEach(() => { Object.defineProperty(globalThis, "FileReader", { value: RealFileReader, configurable: true, writable: true }); });

describe("OrgImageSection", () => {
  it("utan bild: platshållare och uppladdningsknapp, ingen ta bort", () => {
    render(<OrgImageSection title="Logotyp" description="Överst." value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Logotyp" })).toBeInTheDocument();
    expect(screen.getByText("Ingen bild")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ladda upp/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ta bort/ })).toBeNull();
  });

  it("med bild: förhandsvisning, byt-knapp och ta bort → null", () => {
    const onChange = vi.fn();
    render(<OrgImageSection title="Logotyp" description="Överst." value={TINY_PNG} onChange={onChange} />);
    expect(screen.getByRole("img", { name: "Logotyp" })).toHaveAttribute("src", TINY_PNG);
    expect(screen.getByRole("button", { name: /Byt bild/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ta bort/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("uppladdningsknappen öppnar filväljaren", () => {
    const { container } = render(<OrgImageSection title="Logotyp" description="." value={null} onChange={vi.fn()} />);
    const click = vi.spyOn(fileInput(container), "click");
    fireEvent.click(screen.getByRole("button", { name: /Ladda upp/ }));
    expect(click).toHaveBeenCalled();
  });

  it("en giltig PNG sparas som data-URL", async () => {
    const onChange = vi.fn();
    const { container } = render(<OrgImageSection title="Logotyp" description="." value={null} onChange={onChange} />);
    fireEvent.change(fileInput(container), { target: { files: [new File([TINY_PNG_BYTES], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(TINY_PNG));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fel filtyp visar ett fel och sparar inget", async () => {
    const onChange = vi.fn();
    const { container } = render(<OrgImageSection title="Logotyp" description="." value={null} onChange={onChange} />);
    fireEvent.change(fileInput(container), { target: { files: [new File(["GIF89a"], "logo.gif", { type: "image/gif" })] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PNG eller JPEG"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ett tomt filval gör ingenting", () => {
    const onChange = vi.fn();
    const { container } = render(<OrgImageSection title="Logotyp" description="." value={null} onChange={onChange} />);
    fireEvent.change(fileInput(container), { target: { files: [] } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("readFileAsDataUrl", () => {
  it("avvisar när filen inte går att läsa", async () => {
    class FailingReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(): void { this.onerror?.(); }
    }
    // FileReader-ersättning för felvägen — happy-doms läsare misslyckas aldrig.
    Object.defineProperty(globalThis, "FileReader", { value: FailingReader, configurable: true, writable: true });
    await expect(readFileAsDataUrl(new Blob(["x"]))).rejects.toThrow("Kunde inte läsa filen");
  });
});
