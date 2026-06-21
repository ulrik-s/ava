"use client";

/**
 * `HelperAutoConfig` (ADR 0029) — när den lokala helpern finns OCH servern har
 * en OIDC-config (server-first, `system.helperConfig` ≠ null), pushar web-appen
 * configen till helpern över localhost (`POST /config`) EN gång. Då slipper
 * icke-tekniska användare skapa config-filer för hand — de bara använder AVA i
 * webbläsaren som vanligt och helpern blir konfigurerad.
 *
 * Renderar inget. Monteras app-brett (i DemoBootstrap, inuti CapabilitiesProvider).
 */

import { useEffect, useRef } from "react";
import { configureHelper, useHelper } from "@/lib/client/helper/use-helper";
import { trpc } from "@/lib/client/trpc";

export function HelperAutoConfig(): null {
  const helper = useHelper();
  const present = helper.version != null;
  const cfg = trpc.system.helperConfig.useQuery(undefined, { enabled: present, staleTime: Number.POSITIVE_INFINITY });
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current || !present || !cfg.data) return; // null = servern saknar helper-auth (demo)
    pushed.current = true;
    void configureHelper(cfg.data);
  }, [present, cfg.data]);

  return null;
}
