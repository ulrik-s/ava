import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { hash } from "bcryptjs";

export const userRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        pageSize: z.number().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ ctx }) => {
      const users = await ctx.prisma.user.findMany({
        where: { organizationId: ctx.user.organizationId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          title: true,
          role: true,
          hourlyRate: true,
          mileageRate: true,
          createdAt: true,
        },
      });
      return { users };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.user.findUniqueOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          email: true,
          name: true,
          title: true,
          role: true,
          hourlyRate: true,
          mileageRate: true,
          createdAt: true,
        },
      });
    }),

  /**
   * Skapa användare. Lösenord är valfritt — utan lösenord kan användaren
   * endast logga in via Microsoft/O365 (inbjuden, aktiveras vid första
   * lyckade Microsoft-login som länkar azureOid på matchande e-post).
   */
  create: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        title: z.string().optional(),
        role: z.enum(["ADMIN", "LAWYER", "ASSISTANT"]).default("LAWYER"),
        hourlyRate: z.number().nullable().optional(),
        mileageRate: z.number().nullable().optional(),
        password: z.string().min(6).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = input.password ? await hash(input.password, 12) : null;
      return ctx.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          title: input.title,
          role: input.role,
          hourlyRate: input.hourlyRate,
          mileageRate: input.mileageRate,
          passwordHash,
          organizationId: ctx.user.organizationId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        email: z.string().email().optional(),
        name: z.string().min(1).optional(),
        title: z.string().nullable().optional(),
        role: z.enum(["ADMIN", "LAWYER", "ASSISTANT"]).optional(),
        hourlyRate: z.number().nullable().optional(),
        mileageRate: z.number().nullable().optional(),
        password: z.string().min(6).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, password, ...data } = input;
      const updateData: Record<string, unknown> = { ...data };
      if (password) {
        updateData.passwordHash = await hash(password, 12);
      }
      return ctx.prisma.user.update({
        where: { id, organizationId: ctx.user.organizationId },
        data: updateData,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new Error("Du kan inte ta bort dig själv");
      }
      return ctx.prisma.user.delete({
        where: { id: input.id, organizationId: ctx.user.organizationId },
      });
    }),
});
