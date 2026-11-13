/**
 * #1578: `AppVersion` — EN komponent för versionstexten (sidomenyn nu,
 * utloggad-sidan sedan). Ingenting när versionen saknas.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest-compat";
import { AppVersion } from "@/components/shell/app-version";

const ENV = ["NEXT_PUBLIC_AVA_VERSION", "NEXT_PUBLIC_AVA_VERSION_DATE"] as const;
const saved = ENV.map((k) => process.env[k]);
afterEach(() => {
  ENV.forEach((k, i) => {
    const v = saved[i];
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  });
});

describe("AppVersion", () => {
  it("visar byggets version + datum som liten grå text, hela texten som title", () => {
    process.env.NEXT_PUBLIC_AVA_VERSION = "v0.7.11";
    process.env.NEXT_PUBLIC_AVA_VERSION_DATE = "2026-11-13T08:16:45+01:00";
    const { container } = render(<AppVersion className="truncate" />);
    const el = container.querySelector("[data-app-version]");
    expect(el?.textContent).toBe("v0.7.11 · 13 nov 2026");
    expect(el?.getAttribute("title")).toBe("v0.7.11 · 13 nov 2026");
    expect(el?.className).toBe("text-xs text-gray-500 truncate");
  });

  it("saknad version (variabeln inte satt) → renderar ingenting", () => {
    delete process.env.NEXT_PUBLIC_AVA_VERSION;
    delete process.env.NEXT_PUBLIC_AVA_VERSION_DATE;
    const { container } = render(<AppVersion />);
    expect(container.innerHTML).toBe("");
  });
});
