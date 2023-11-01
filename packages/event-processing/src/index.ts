import { ClickHouseClient } from "@clickhouse/client";
import { getUnixTime } from "date-fns";
import { Client } from "pg";
import { compileSqrl, createSqrlInstance, type Event } from "sqrl-helpers";
import { EventOutput, runEvent } from "sqrl-helpers/src/utils/runEvent";

import { prisma } from "databases";

type DatasetData = {
  datasetId: bigint;
  code: Record<string, string>;
  lastEventLogId: string;
};
export async function getDatasetData(props: {
  datasetId: bigint;
}): Promise<DatasetData> {
  const { datasetId } = props;

  const res = await prisma.$queryRaw<DatasetData[]>`
        SELECT
        "Dataset"."id" AS "datasetId",
        "EventHandler"."code",
        "Dataset"."lastEventLogId"
        FROM "Dataset"
        JOIN "EventHandlerAssignment" ON "Dataset"."currentEventHandlerAssignmentId" = "EventHandlerAssignment"."id"
        JOIN "EventHandler" ON "EventHandlerAssignment"."eventHandlerId" = "EventHandler"."id"
        WHERE "Dataset"."id" = ${datasetId}
    `;

  if (res.length === 0) {
    throw new Error(`No Dataset found for datasetId ${datasetId}`);
  }

  return res[0]!;
}

export async function getEvents(props: {
  lastEventLogId: string;
  isProduction: boolean;
}): Promise<Event[]> {
  const { lastEventLogId, isProduction } = props;

  if (isProduction) {
    return prisma.$queryRaw<Event[]>`
        SELECT "id", "type", "data", "timestamp"
        FROM "EventLog"
        WHERE (
          ${lastEventLogId}::text IS NULL
          OR "id" > ${lastEventLogId}
        )
        AND (
          NOT ("EventLog"."options" ? 'sync') -- The key 'sync' does not exist
          OR "EventLog"."options"->>'sync' = 'false' -- The key 'sync' exists and its value is 'false'
        )
        ORDER BY "id" ASC
        LIMIT 1000;
    `;
  } else {
    return prisma.$queryRaw<Event[]>`
        SELECT "id", "type", "data", "timestamp"
        FROM "EventLog"
        WHERE (
          ${lastEventLogId}::text IS NULL
          OR "id" > ${lastEventLogId}
        )
        ORDER BY "id" ASC
        LIMIT 1000;
    `;
  }
}

export async function processEvents(props: {
  events: Event[];
  files: Record<string, string>;
  datasetId: bigint;
}): Promise<EventOutput[]> {
  const { events, files, datasetId } = props;

  const results: Awaited<ReturnType<typeof runEvent>>[] = [];
  const instance = await createSqrlInstance({
    config: {
      "redis.address": process.env.REDIS_URL,
    },
  });

  const { executable } = await compileSqrl(instance, files);

  for (const event of events) {
    results.push(await runEvent({ event, executable, datasetId }));
  }

  return results;
}

export async function batchInsertEvents(props: {
  events: EventOutput[];
  clickhouseClient: ClickHouseClient;
}) {
  const { events, clickhouseClient } = props;

  await clickhouseClient.insert({
    table: "event_entity",
    values: events.flatMap((event) =>
      event.entities.length
        ? event.entities.map((entity) => ({
            created_at: getUnixTime(new Date()),
            event_id: event.id,
            event_type: event.type,
            event_timestamp: getUnixTime(event.timestamp),
            event_data: event.data,
            features: event.features,
            entity_id: entity.id,
            entity_type: entity.type,
            dataset_id: event.datasetId.toString(),
          }))
        : {
            created_at: getUnixTime(new Date()),
            event_id: event.id,
            event_type: event.type,
            event_timestamp: getUnixTime(event.timestamp),
            event_data: event.data,
            features: event.features,
            dataset_id: event.datasetId.toString(),
          }
    ),
    format: "JSONEachRow",
    clickhouse_settings: {
      async_insert: 1,
    },
  });
}
