/**
 * Telefonflikarna (#1672): fliknamnen är feta i ljust läge, på både vald och
 * inaktiv flik; mörkt läge behåller normal vikt.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { PhonePanels } from "@/components/layout/phone-panels";

const panels = [
  { id: "a", title: "Första", render: () => <p>a-innehåll</p> },
  { id: "b", title: "Andra", render: () => <p>b-innehåll</p> },
];

describe("PhonePanels flikar (#1672)", () => {
  it("vald och inaktiv flik är feta i ljust läge och normala i mörkt", () => {
    render(<PhonePanels panels={panels} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    for (const tab of tabs) {
      expect(tab.className.split(/\s+/)).toEqual(expect.arrayContaining(["font-semibold", "dark:font-normal"]));
    }
  });
});
