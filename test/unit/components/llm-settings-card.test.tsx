/**
 * Smoke-test för `LlmSettingsCard` — toggle + modell-väljare + download-knapp.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LlmSettingsCard } from "@/components/llm/llm-settings-card";
import { resetLlmConfig } from "@/lib/client/llm/llm-config";
import { resetActiveLlm } from "@/lib/client/llm/active-llm";

const engineHoisted = vi.hoisted(() => ({
  CreateMLCEngine: vi.fn(async (_id, opts) => {
    // Simulera progress
    opts?.initProgressCallback?.({ progress: 0.5, text: "Fetching" });
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));
vi.mock("@mlc-ai/web-llm", () => engineHoisted);

beforeEach(() => {
  localStorage.clear();
  resetLlmConfig();
  resetActiveLlm();
  engineHoisted.CreateMLCEngine.mockClear();
});

describe("LlmSettingsCard", () => {
  it("renderar rubrik + toggle (av default)", () => {
    render(<LlmSettingsCard />);
    expect(screen.getByText(/AI \(lokal LLM\)/)).toBeInTheDocument();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("toggle → visar modell-väljare + ladda-ner-knapp", () => {
    render(<LlmSettingsCard />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("button", { name: /Ladda ner modell/i })).toBeInTheDocument();
    expect(screen.getByText(/Llama 3.2 1B/)).toBeInTheDocument();
  });

  it("download-knapp triggar CreateMLCEngine", async () => {
    render(<LlmSettingsCard />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Ladda ner modell/i }));
    await waitFor(() => expect(engineHoisted.CreateMLCEngine).toHaveBeenCalled());
  });

  it("modell-väljare byter modell-id i config", () => {
    render(<LlmSettingsCard />);
    fireEvent.click(screen.getByRole("switch"));
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "Llama-3.2-3B-Instruct-q4f16_1-MLC" } });
    expect((select as HTMLSelectElement).value).toBe("Llama-3.2-3B-Instruct-q4f16_1-MLC");
  });

  it("toggle av igen → modell-väljare försvinner", () => {
    render(<LlmSettingsCard />);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw); // på
    expect(screen.queryByRole("combobox")).toBeInTheDocument();
    fireEvent.click(sw); // av
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
