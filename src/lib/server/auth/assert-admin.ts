import { TRPCError } from "@trpc/server";

/** Kasta FORBIDDEN om anroparen inte är administratör. */
export function assertAdmin(ctx: { user: { role: string } }): void {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Endast administratörer kan göra det här." });
  }
}
