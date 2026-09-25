/**
 * En listsida (#1184): huvudet (rubrik, knappar, filter) och sidfoten (bläddring)
 * står still, listan scrollar mellan dem — sidan själv scrollar aldrig.
 * Kolumnerna är redan konfigurerbara per användare (DataTable), så listsidor
 * behöver inga dockbara paneler.
 */

import type { ReactNode } from "react";

export function ListPage({ header, footer, children }: { header: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">{header}</div>
      {/* relative: absolut positionerade barn (t.ex. sr-only-texter) stannar i listan i st.f. att förlänga dokumentet. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer !== undefined && <div className="shrink-0 pt-2">{footer}</div>}
    </div>
  );
}
