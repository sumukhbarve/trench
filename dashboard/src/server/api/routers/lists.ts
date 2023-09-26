import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { entityFiltersZod, eventFiltersZod } from "../../../shared/validation";
import {
  JsonFilter,
  JsonFilterOp,
  parseValue,
} from "../../../shared/jsonFilter";
import {
  buildEntityExistsQuery,
  buildEventExistsQuery,
  getEntityExistsSubqueries,
  getFiltersWhereQuery,
} from "../../lib/filters";
import { Entity, PrismaClient } from "@prisma/client";

export const listsRouter = createTRPCRouter({
  getEntitiesList: publicProcedure
    .input(
      z.object({
        entityFilters: entityFiltersZod,
        sortBy: z.object({
          feature: z.string(),
          direction: z.enum(["asc", "desc"]),
          dataType: z.enum(["string", "number", "boolean"]).optional(),
        }),
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = input.entityFilters;
      const [count, rows] = await Promise.all([
        ctx.prisma.entity.count({
          // where: {
          //   entityType: {
          //     id: input.entityFilters?.entityType,
          //   },
          // },
        }),
        getFilteredEntities(
          ctx.prisma,
          input.entityFilters?.entityType,
          input.entityFilters?.entityLabels,
          input.entityFilters?.entityFeatures,
          input.limit,
          input.offset,
          input.sortBy
        ),
      ]);
      return {
        count,
        rows,
      };
    }),

  getEventsList: publicProcedure
    .input(
      z.object({
        eventFilters: eventFiltersZod,
        cursor: z.string().optional(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const filters = input.eventFilters;
      const features = filters?.eventFeatures
        ? getFeaturesFilter(filters.eventFeatures, `"Event"."features"`)
        : "";

      const cursor = input.cursor;

      const [count, rows] = await Promise.all([
        ctx.prisma.event.count({
          where: getFiltersWhereQuery(input.eventFilters),
        }),
        ctx.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            type: string;
            data: string;
            timestamp: Date;
            features: Record<string, any>;
            labels: Array<{
              id: string;
              name: string;
              color: string;
            }>;
            entities: {
              id: string;
              name: string;
              type: string;
              features: Record<string, any>;
            }[];
          }>
        >(`
          SELECT
            "Event"."id" as "id",
            "Event"."type" as "type",
            "Event"."data" as "data",
            "Event"."timestamp" as "timestamp",
            "Event"."features" as "features",
            JSON_AGG(
              json_build_object(
                'id', "_EventToEventLabel"."B",
                'name', "EventLabel"."name",
                'color', "EventLabel"."color"
              )
            ) as "labels",
            JSON_AGG(
              json_build_object(
                'id', "EventToEntityLink"."entityId",
                'name', "Entity"."name",
                'type', "Entity"."type",
                'features', "Entity"."features"
              )
            ) as "entities"
          FROM "Event"
          LEFT JOIN "_EventToEventLabel" ON "Event"."id" = "_EventToEventLabel"."A"
          LEFT JOIN "EventLabel" ON "_EventToEventLabel"."B" = "EventLabel"."id"
          LEFT JOIN "EventToEntityLink" ON "Event"."id" = "EventToEntityLink"."eventId"
          LEFT JOIN "Entity" ON "EventToEntityLink"."entityId" = "Entity"."id"
          WHERE ${buildEventExistsQuery(input.eventFilters)}
          ${cursor ? `AND "Event"."timestamp" <= '${cursor}'` : ""}
          ${features}
          GROUP BY
            "Event"."id",
            "Event"."type",
            "Event"."data",
            "Event"."timestamp"
          ORDER BY "Event"."timestamp" DESC
          LIMIT ${input.limit ?? 10}
        `),
      ]);

      return {
        count,
        rows: rows.map((row) => {
          return {
            ...row,
            labels: row.labels.filter((label) => label.id !== null),
          };
        }),
      };
    }),

  // prob doesnt work
  getFeatureColumnsForEventType: publicProcedure
    .input(
      z.object({
        eventType: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const vals = await ctx.prisma.eventFeature.findMany({
        where: {
          eventType: input.eventType,
        },
      });
      return vals;
    }),

  getEvent: publicProcedure
    .input(
      z.object({
        eventId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const event = await ctx.prisma.event.findUnique({
        where: {
          id: input.eventId,
        },
        include: {
          eventLabels: true,
          eventType: true,
          entityLinks: {
            include: {
              entity: {
                include: {
                  entityLabels: true,
                },
              },
            },
          },
        },
      });
      return event;
    }),

  getEventsOfType: publicProcedure
    .input(
      z.object({
        eventTypeId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [count, rows] = await Promise.all([
        ctx.prisma.event.count({
          where: {
            eventType: {
              id: input.eventTypeId,
            },
          },
        }),
        ctx.prisma.event.findMany({
          where: {
            eventType: {
              id: input.eventTypeId,
            },
          },
          include: {
            eventLabels: true,
            eventType: true,
          },
          orderBy: {
            timestamp: "desc",
          },
          take: input.limit,
          skip: input.offset,
        }),
      ]);
      return {
        count,
        rows,
      };
    }),
});

const getFeaturesFilter = (filters: JsonFilter[], jsonPath: string) => {
  return filters
    .map(({ path, op, value, dataType }) => {
      if (op === JsonFilterOp.IsEmpty)
        return `AND ${jsonPath}->>'${path}' IS NULL OR ${jsonPath}->>'${path}' = ''`;
      if (op === JsonFilterOp.NotEmpty)
        return `AND ${jsonPath}->>'${path}' IS NOT NULL AND ${jsonPath}->>'${path}' != ''`;

      const sqlOperator = {
        [JsonFilterOp.Equal]: "=",
        [JsonFilterOp.NotEqual]: "!=",
        [JsonFilterOp.GreaterThan]: ">",
        [JsonFilterOp.LessThan]: "<",
      }[op];

      if (sqlOperator)
        return `AND (${jsonPath}->>'${path}')${
          dataType === "number" ? "::NUMERIC" : ""
        } ${sqlOperator} ${dataType === "number" ? value : `'${value}'`}`;

      const sqlOperator2 = {
        [JsonFilterOp.Contains]: `LIKE '%${value}%'`,
        [JsonFilterOp.DoesNotContain]: `NOT LIKE '%${value}%'`,
        [JsonFilterOp.StartsWith]: `LIKE '${value}%'`,
        [JsonFilterOp.EndsWith]: `LIKE '%${value}'`,
      }[op];

      if (sqlOperator2) return `AND ${jsonPath}->>'${path}' ${sqlOperator2}`;
    })
    .join(" ");
};

async function getFilteredEntities(
  prisma: PrismaClient,
  entityType?: string,
  entityLabels?: string[],
  entityFeatures?: JsonFilter[],
  limit?: number,
  offset?: number,
  sortBy?: {
    feature: string;
    direction: "asc" | "desc";
    dataType?: "string" | "number";
  }
) {
  const features = entityFeatures
    ? getFeaturesFilter(entityFeatures, `"Entity"."features"`)
    : "";

  const orderByFeature = sortBy?.feature
    ? `("Entity"."features"->>'${sortBy.feature}')${
        sortBy.dataType === "number" ? "::NUMERIC" : ""
      } ${sortBy.direction}`
    : `matViewSubquery."timestamp" DESC`;

  const rawResults = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      name: string;
      type: string;
      features: Record<string, any>;
      labels: Array<{
        id: string;
        name: string;
        color: string;
      }>;
      lastSeenAt: Date;
    }>
  >(`
    SELECT
      "Entity"."id" as "id",
      "Entity"."name" as "name",
      "Entity"."type" as "type",
      "Entity"."features" as "features",
      JSON_AGG(
        json_build_object(
          'id', "_EntityToEntityLabel"."B",
          'name', "EntityLabel"."name",
          'color', "EntityLabel"."color"
        )
      ) as "labels",
      matViewSubquery."timestamp" as "lastSeenAt"
    FROM "Entity"
    LEFT JOIN (
      SELECT "entityId", MAX("timestamp") as "timestamp"
      FROM "EntityAppearancesMatView"
      GROUP BY "entityId"
    ) as matViewSubquery ON "Entity"."id" = matViewSubquery."entityId"
    LEFT JOIN "_EntityToEntityLabel" ON "Entity"."id" = "_EntityToEntityLabel"."A"
    LEFT JOIN "EntityLabel" ON "_EntityToEntityLabel"."B" = "EntityLabel"."id"
    WHERE TRUE
      ${entityType ? `AND "Entity"."type" = '${entityType}'` : ""}
      ${
        entityLabels?.length
          ? entityLabels
              .map((label) => {
                return `AND EXISTS (
              SELECT FROM "EntityAppearancesMatView"
              WHERE "EntityAppearancesMatView"."entityId" = "Entity"."id"
              AND "EntityAppearancesMatView"."entityLabel" = '${label}'
            )`;
              })
              .join("\n")
          : ""
      }
      ${features}
    GROUP BY
      "Entity"."id",
      "Entity"."type",
      "Entity"."features",
      matViewSubquery."timestamp"
    ORDER BY ${orderByFeature}
    LIMIT ${limit ?? 10}
    OFFSET ${offset ?? 0}
  `);

  // Do some additional client-side processing here if needed

  return rawResults.map((row) => {
    return {
      ...row,
      labels: row.labels,
    };
  });
}
