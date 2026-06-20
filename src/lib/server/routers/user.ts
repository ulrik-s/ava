import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { userIdSchema, asId } from "@/lib/shared/schemas/ids";
import { matterNumberPrefixSchema, type User } from "@/lib/shared/schemas/user";
import { router, protectedProcedure } from "../trpc";

/** Projektion till listvyns fält (utan passwordHash). */
function pickList(u: User) {
  return {
    id: u.id, email: u.email, name: u.name, title: u.title ?? null, role: u.role,
    hourlyRate: u.hourlyRate ?? null, mileageRate: u.mileageRate ?? null,
    matterNumberPrefix: u.matterNumberPrefix ?? null, createdAt: u.createdAt as Date,
  };
}
// bcryptjs är borttagen — pure-git-modellen har inte server-side
// password-hashing. Om/när lokal HTTP Basic Auth införs på Linux-boxen
// hanteras htpasswd av nginx (bcrypt-strängar genereras med `htpasswd -B`,
// inte i appen). Tills dess: vi sparar bara klartext-flaggan att en
// password finns; verifiering sker utanför appen.
async function hashPassword(password: string): Promise<string> {
  // Markör-prefix så det är uppenbart att detta INTE är ett färdigt
  // bcrypt-hash. Riktig hashing måste göras innan vi går prod.
  return `placeholder:${password.length}-chars`;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  title: string | null;
  role: string;
  hourlyRate: number | null;
  mileageRate: number | null;
  matterNumberPrefix: string | null;
  createdAt: Date;
}

function assertAdmin(ctx: { user: { role: string; id: string } }): void {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Endast administratörer kan göra det här." });
  }
}

export const userRouter = router({
  /**
   * Vem är jag? Använd av /profile-vyn för att slippa skicka in
   * userId. ctx.user kommer från auth-laget (eller demoanvändaren i
   * demoläget).
   *
   * Returnerar ett stabilt UserProfile-objekt — om användaren saknas
   * i users-tabellen (demoanvändaren) skapar vi en transient
   * representation som UI:n kan visa men inte mutera.
   */
  current: protectedProcedure.query(async ({ ctx }): Promise<UserProfile> => {
    // Migrerad till repository-sömmen (ADR 0020). Saknas user:n (demoanvändaren)
    // returnerar vi en transient profil som UI:n kan visa men inte mutera.
    const u = await ctx.repos.users.getByIdInOrg(ctx.user.id, ctx.user.organizationId);
    if (!u) {
      return {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        title: null,
        role: ctx.user.role,
        hourlyRate: null,
        mileageRate: null,
        matterNumberPrefix: null,
        createdAt: new Date(),
      };
    }
    return pickList(u);
  }),

  list: protectedProcedure
    .input(z.object({ pageSize: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx }) => {
      const rows = await ctx.repos.users.listByOrg(ctx.user.organizationId);
      return { users: rows.map(pickList) };
    }),

  getById: protectedProcedure
    .input(z.object({ id: userIdSchema }))
    .query(async ({ ctx, input }) => {
      const u = await ctx.repos.users.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!u) throw new TRPCError({ code: "NOT_FOUND" });
      return pickList(u);
    }),

  /**
   * Skapa användare. ADMIN-bara.
   */
  create: protectedProcedure
    .input(z.object({
      /** Valfritt klient-genererat id (ADR 0003) — annars genererar store:n. */
      id: userIdSchema.optional(),
      email: z.string().email(),
      name: z.string().min(1),
      title: z.string().optional(),
      role: z.enum(["ADMIN", "LAWYER", "ASSISTANT"]).default("LAWYER"),
      hourlyRate: z.number().nullable().optional(),
      mileageRate: z.number().nullable().optional(),
      /** Ärendenummer-prefix (#174) — juristens egen serie. */
      matterNumberPrefix: matterNumberPrefixSchema.optional(),
      password: z.string().min(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      return ctx.repos.users.create({
        ...(input.id ? { id: input.id } : {}),
        email: input.email,
        name: input.name,
        title: input.title,
        role: input.role,
        hourlyRate: input.hourlyRate,
        mileageRate: input.mileageRate,
        ...(input.matterNumberPrefix ? { matterNumberPrefix: input.matterNumberPrefix } : {}),
        passwordHash,
        organizationId: asId<"OrganizationId">(ctx.user.organizationId),
      } as Partial<User>);
    }),

  /**
   * Uppdatera en användare. Användaren kan ändra sina EGNA fält
   * (namn, titel, sats). Endast ADMIN kan ändra role eller annan
   * användares data.
   */
  update: protectedProcedure
    .input(z.object({
      id: userIdSchema,
      email: z.string().email().optional(),
      name: z.string().min(1).optional(),
      title: z.string().nullable().optional(),
      role: z.enum(["ADMIN", "LAWYER", "ASSISTANT"]).optional(),
      hourlyRate: z.number().nullable().optional(),
      mileageRate: z.number().nullable().optional(),
      /** Ärendenummer-prefix (#174); null rensar den. Byte fortsätter serien. */
      matterNumberPrefix: matterNumberPrefixSchema.nullable().optional(),
      password: z.string().min(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isSelf = input.id === ctx.user.id;
      const isAdmin = ctx.user.role === "ADMIN";
      if (!isSelf && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Du kan bara ändra din egen profil." });
      }
      if (input.role && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Endast administratörer kan ändra roller." });
      }
      const { id, password, ...data } = input;
      // Org-scope: verifiera ägarskap (motsvarar gamla where:{id,organizationId}).
      const owned = await ctx.repos.users.getByIdInOrg(id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const updateData: Record<string, unknown> = { ...data };
      if (password) updateData.passwordHash = await hashPassword(password);
      return ctx.repos.users.update(id, updateData as Partial<User>);
    }),

  /**
   * Inaktivera (ej hård-delete). ADMIN-bara. Sätter `active: false`
   * så historik bevaras.
   */
  deactivate: protectedProcedure
    .input(z.object({ id: userIdSchema }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kan inte inaktivera dig själv." });
      }
      const owned = await ctx.repos.users.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.repos.users.update(input.id, { active: false });
    }),

  /** Hård-delete behållen för bakåtkompabilitet, men ADMIN-only. */
  delete: protectedProcedure
    .input(z.object({ id: userIdSchema }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kan inte ta bort dig själv." });
      }
      const owned = await ctx.repos.users.getByIdInOrg(input.id, ctx.user.organizationId);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Hård delete bevarad (bakåtkompat, ADR 0017-delete-policy öppen).
      await ctx.repos.users.hardDelete(input.id);
      return { id: input.id };
    }),
});
