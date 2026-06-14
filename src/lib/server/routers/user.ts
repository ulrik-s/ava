import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { userIdSchema, asId } from "@/lib/shared/schemas/ids";
import { publicKeySchema, matterNumberPrefixSchema, type PublicKey } from "@/lib/shared/schemas/user";
import { router, protectedProcedure } from "../trpc";
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

// Smal select för listor — håller utgående typ stabil för konsumenter
// (reports, tids-rader, etc.) som inte bryr sig om nycklar.
const USER_LIST_SELECT = {
  id: true,
  email: true,
  name: true,
  title: true,
  role: true,
  hourlyRate: true,
  mileageRate: true,
  matterNumberPrefix: true,
  createdAt: true,
} as const;
// Profil-select inkluderar publicKeys. Lagras som JSON-array på User
// (`Json`-fält i Prisma eller serialiserad sträng). I demo:n läses
// det in från användarens .json-fil.
const USER_PROFILE_SELECT = {
  ...USER_LIST_SELECT,
  publicKeys: true,
} as const;

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
  publicKeys: PublicKey[];
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
    try {
      const u = await ctx.dataStore.users.findUniqueOrThrow({
        where: { id: ctx.user.id, organizationId: ctx.user.organizationId },
        select: USER_PROFILE_SELECT,
      }) as unknown as UserProfile;
      return { ...u, publicKeys: Array.isArray(u.publicKeys) ? u.publicKeys : [] };
    } catch (_e) {
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
        publicKeys: [],
      };
    }
  }),

  list: protectedProcedure
    .input(z.object({ pageSize: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx }) => {
      const users = await ctx.dataStore.users.findMany({
        where: { organizationId: ctx.user.organizationId },
        orderBy: { name: "asc" },
        select: USER_LIST_SELECT,
      });
      return { users };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Använder list-select (utan publicKeys) eftersom nycklar är
      // privata — bara `current` exponerar dem.
      return ctx.dataStore.users.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: USER_LIST_SELECT,
      });
    }),

  /**
   * Skapa användare. ADMIN-bara. Användaren registrerar sedan själv
   * sina egna nycklar via `addKey` — admin har inte tillgång till dem.
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
      return ctx.dataStore.users.create({
        data: {
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
          publicKeys: [],
        },
      });
    }),

  /**
   * Uppdatera en användare. Användaren kan ändra sina EGNA fält
   * (namn, titel, sats). Endast ADMIN kan ändra role eller annan
   * användares data.
   */
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
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
      const updateData: Record<string, unknown> = { ...data };
      if (password) updateData.passwordHash = await hashPassword(password);
      return ctx.dataStore.users.update({
        where: { id, organizationId: ctx.user.organizationId },
        data: updateData,
      });
    }),

  /**
   * Lägg till en publik nyckel på EGEN profil. Admin kan inte göra
   * detta åt andra — nyckeln är användarens egendom.
   */
  addKey: protectedProcedure
    .input(publicKeySchema)
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.dataStore.users.findUniqueOrThrow({
        where: { id: ctx.user.id, organizationId: ctx.user.organizationId },
        select: { publicKeys: true },
      }) as unknown as { publicKeys?: unknown[] };
      const keys = Array.isArray(u.publicKeys) ? u.publicKeys : [];
      if (keys.some((k) => (k as { fingerprint: string }).fingerprint === input.fingerprint)) {
        throw new TRPCError({ code: "CONFLICT", message: "Nyckel med samma fingerprint finns redan." });
      }
      return ctx.dataStore.users.update({
        where: { id: ctx.user.id, organizationId: ctx.user.organizationId },
        data: { publicKeys: [...keys, input] } as unknown as Record<string, unknown>,
      });
    }),

  removeKey: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.dataStore.users.findUniqueOrThrow({
        where: { id: ctx.user.id, organizationId: ctx.user.organizationId },
        select: { publicKeys: true },
      }) as unknown as { publicKeys?: unknown[] };
      const keys = (Array.isArray(u.publicKeys) ? u.publicKeys : []).filter(
        (k) => (k as { fingerprint: string }).fingerprint !== input.fingerprint,
      );
      return ctx.dataStore.users.update({
        where: { id: ctx.user.id, organizationId: ctx.user.organizationId },
        data: { publicKeys: keys } as unknown as Record<string, unknown>,
      });
    }),

  /**
   * Inaktivera (ej hård-delete). ADMIN-bara. Sätter `active: false`
   * så historik bevaras.
   */
  deactivate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kan inte inaktivera dig själv." });
      }
      return ctx.dataStore.users.update({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        data: { active: false } as unknown as Record<string, unknown>,
      });
    }),

  /** Hård-delete behållen för bakåtkompabilitet, men ADMIN-only. */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx);
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Du kan inte ta bort dig själv." });
      }
      return ctx.dataStore.users.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
    }),
});
