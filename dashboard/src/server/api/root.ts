import { createTRPCRouter } from "~/server/api/trpc";
import { eventsRouter } from "./routers/events";
import { entitiesRouter } from "./routers/entities";
import { labelsRouter } from "./routers/labels";
import { rulesetsRouter } from "./routers/rulesets";
import { listsRouter } from "./routers/lists";
import { dashboardRouter } from "./routers/dashboard";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  events: eventsRouter,
  entities: entitiesRouter,
  labels: labelsRouter,
  rulesets: rulesetsRouter,
  lists: listsRouter,
  dashboard: dashboardRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
