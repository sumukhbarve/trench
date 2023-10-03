import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";

export const labelsRouter = createTRPCRouter({
  getAllLabels: publicProcedure.query(async ({ ctx, input }) => {
    const [eventLabels, entityLabels] = await ctx.prisma.$transaction([
      ctx.prisma.eventLabel.findMany(),
      ctx.prisma.entityLabel.findMany(),
    ]);

    return {
      eventLabels,
      entityLabels,
    };
  }),
  getEventLabels: publicProcedure
    .input(
      z.object({
        eventType: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await db.query({
        query: `
          SELECT DISTINCT label
          FROM event_labels
          WHERE event_type = '${input.eventType}' OR 1=1;
        `,
        format: "JSONEachRow",
      });
      const data = await result.json<{ label: string }[]>();
      return data.map((row) => row.label);
    }),
  getEntityLabels: publicProcedure
    .input(
      z.object({
        entityType: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await db.query({
        query: `
          SELECT DISTINCT label
          FROM entity_labels
          ${input.entityType ? `WHERE entity_type = '${input.entityType}'` : ""}
        `,
        format: "JSONEachRow",
      });
      const data = await result.json<{ label: string }[]>();
      return data.map((row) => row.label);
    }),
  getEventTypes: publicProcedure.query(async ({ ctx }) => {
    const result = await db.query({
      query: `
          SELECT DISTINCT event_type
          FROM event_entity;
        `,
      format: "JSONEachRow",
    });
    const types = await result.json<{ event_type: string }[]>();
    return types.map((type) => type.event_type);
  }),
  getEntityTypes: publicProcedure.query(async ({ ctx }) => {
    const result = await db.query({
      query: `
          SELECT DISTINCT entity_type
          FROM event_entity;
        `,
      format: "JSONEachRow",
    });
    const types = await result.json<{ entity_type: string }[]>();
    return types.map((type) => type.entity_type);
  }),
  getLinkTypes: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.linkType.findMany();
  }),
  getEntityFeatures: publicProcedure
    .input(z.object({ entityType: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await db.query({
        query: `
          SELECT DISTINCT feature
          FROM event_entity
          ARRAY JOIN JSONExtractKeys(entity_features) AS feature;
        `,
        format: "JSONEachRow",
      });
      const features = await result.json<{ feature: string }[]>();
      return features.flatMap((feature) => feature.feature);
    }),
  getEventFeatures: publicProcedure
    .input(z.object({ eventType: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await db.query({
        query: `
          SELECT DISTINCT feature
          FROM event_entity
          ARRAY JOIN JSONExtractKeys(event_features) AS feature;
        `,
        format: "JSONEachRow",
      });
      const features = await result.json<{ feature: string }[]>();
      return features.flatMap((feature) => feature.feature);
    }),
});
