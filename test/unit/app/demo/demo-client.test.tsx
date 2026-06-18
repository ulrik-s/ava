/**
 * Tester för `DemoClient` — Client Component som låter user:n klistra
 * in en GitHub-url och se demo-datat renderat.
 *
 * Tester verifierar:
 *   - Input → click → state-övergångar (idle/loading/loaded/error)
 *   - Renderar listor av matters, contacts, users
 *   - Tomt URL ger ingen load
 *   - DI: `loader` injiceras så vi mockar bort GH-Pages-fetchen (#420)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { DemoClient } from "@/app/demo/_demo-client";
import type { DemoSource } from "@/lib/shared/demo-source";

const matter = {
  id: "m1", matterNumber: "2026-0001", title: "Demo-ärende",
  status: "ACTIVE", organizationId: "demo",
};
const contact = {
  id: "c1", name: "Demo Klient", contactType: "PERSON", organizationId: "demo",
};

/** Fake-loader som returnerar en färdig DemoSource (ingen fetch). */
function fakeLoader(source: DemoSource) {
  return () => Promise.resolve(source);
}

describe("DemoClient", () => {
  it("renderar URL-input och tom-state initialt (utan auto-load)", () => {
    render(<DemoClient loader={fakeLoader({})} defaultRepo="" />);
    expect(screen.getByRole("textbox", { name: /GitHub-url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ladda demo/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Ärenden/i })).not.toBeInTheDocument();
  });

  it("klick på 'Ladda demo' utan url gör ingen request", () => {
    const loader = vi.fn(fakeLoader({}));
    render(<DemoClient loader={loader} defaultRepo="" />);
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));
    expect(loader).not.toHaveBeenCalled();
    expect(screen.queryByText(/Laddar/i)).not.toBeInTheDocument();
  });

  it("vid lyckad load renderas ärenden + kontakter", async () => {
    render(<DemoClient loader={fakeLoader({ matters: [matter], contacts: [contact] })} defaultRepo="" />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "https://github.com/x/demo.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/Demo-ärende/i)).toBeInTheDocument());
    expect(screen.getByText(/Demo Klient/i)).toBeInTheDocument();
  });

  it("visar felmeddelande vid ladd-fel", async () => {
    render(<DemoClient
      loader={() => Promise.reject(new Error("Repo hittades inte"))}
      defaultRepo=""
    />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "https://github.com/x/missing.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/Repo hittades inte/i)).toBeInTheDocument());
  });

  it("visar 'Laddar...' under pågående load", async () => {
    let resolve: (s: DemoSource) => void = () => {};
    render(<DemoClient
      loader={() => new Promise<DemoSource>((r) => { resolve = r; })}
      defaultRepo=""
    />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    expect(await screen.findByText(/Laddar/i)).toBeInTheDocument();
    resolve({});
  });

  it("renderar antal-räknare per entitetstyp", async () => {
    const m2 = { id: "m2", matterNumber: "2026-0002", title: "T2", status: "ACTIVE", organizationId: "demo" };
    render(<DemoClient loader={fakeLoader({ matters: [matter, m2], contacts: [contact] })} defaultRepo="" />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/2 ärenden/i)).toBeInTheDocument());
    expect(screen.getByText(/1 kontakter/i)).toBeInTheDocument();
  });

  it("auto-laddar default-repo vid mount (utan att kräva user-input)", async () => {
    const loader = vi.fn(async (repo: string) => {
      expect(repo).toBe("ulrik-s/ava-demo");
      return { matters: [matter] } as DemoSource;
    });
    render(<DemoClient loader={loader} defaultRepo="ulrik-s/ava-demo" />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Demo-ärende/i)).toBeInTheDocument());
  });
});
