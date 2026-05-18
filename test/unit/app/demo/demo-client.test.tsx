/**
 * Tester för `DemoClient` — Client Component som låter user:n klistra
 * in en GitHub-url och se demo-datat renderat.
 *
 * Tester verifierar:
 *   - Input → click → state-övergångar (idle/loading/loaded/error)
 *   - Renderar listor av matters, contacts, users
 *   - Tomt URL ger ingen load
 *   - DI: factory injiceras så vi mockar bort isomorphic-git
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DemoClient } from "@/app/demo/_demo-client";
import { DemoRuntime } from "@/server/local-first/demo-runtime";

function fakeRuntimeFactory(data: Record<string, string>) {
  return () => DemoRuntime.create({
    async cloneFn(fs) {
      for (const [p, c] of Object.entries(data)) await fs.writeFile(p, c);
    },
  });
}

const matterJson = JSON.stringify({
  id: "m1", matterNumber: "2026-0001", title: "Demo-ärende",
  status: "ACTIVE", organizationId: "demo",
});
const contactJson = JSON.stringify({
  id: "c1", name: "Demo Klient", contactType: "PERSON", organizationId: "demo",
});

describe("DemoClient", () => {
  it("renderar URL-input och tom-state initialt", () => {
    render(<DemoClient runtimeFactory={fakeRuntimeFactory({})} />);
    expect(screen.getByRole("textbox", { name: /GitHub-url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ladda demo/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Ärenden/i })).not.toBeInTheDocument();
  });

  it("klick på 'Ladda demo' utan url gör ingen request", () => {
    const factory = vi.fn(fakeRuntimeFactory({}));
    render(<DemoClient runtimeFactory={factory} />);
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));
    // Factory anropas vid mount (för memo) men loadDemo ska inte ha körts
    // → ingen "Laddar..."-text
    expect(screen.queryByText(/Laddar/i)).not.toBeInTheDocument();
  });

  it("vid lyckad load renderas ärenden + kontakter", async () => {
    render(<DemoClient runtimeFactory={fakeRuntimeFactory({
      "matters/active/m1.json": matterJson,
      "contacts/c1.json": contactJson,
    })} />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "https://github.com/x/demo.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/Demo-ärende/i)).toBeInTheDocument());
    expect(screen.getByText(/Demo Klient/i)).toBeInTheDocument();
  });

  it("visar felmeddelande vid clone-fel", async () => {
    render(<DemoClient
      runtimeFactory={() => DemoRuntime.create({
        cloneFn: async () => { throw new Error("Repo hittades inte"); },
      })}
    />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "https://github.com/x/missing.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/Repo hittades inte/i)).toBeInTheDocument());
  });

  it("visar 'Laddar...' under pågående clone", async () => {
    let resolve: () => void = () => {};
    render(<DemoClient
      runtimeFactory={() => DemoRuntime.create({
        cloneFn: () => new Promise<void>((r) => { resolve = r; }),
      })}
    />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    expect(await screen.findByText(/Laddar/i)).toBeInTheDocument();
    resolve();
  });

  it("renderar antal-räknare per entitetstyp", async () => {
    render(<DemoClient runtimeFactory={fakeRuntimeFactory({
      "matters/active/m1.json": matterJson,
      "matters/active/m2.json": JSON.stringify({
        id: "m2", matterNumber: "2026-0002", title: "T2",
        status: "ACTIVE", organizationId: "demo",
      }),
      "contacts/c1.json": contactJson,
    })} />);

    fireEvent.change(screen.getByRole("textbox", { name: /GitHub-url/i }), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ladda demo/i }));

    await waitFor(() => expect(screen.getByText(/2 ärenden/i)).toBeInTheDocument());
    expect(screen.getByText(/1 kontakter/i)).toBeInTheDocument();
  });
});
