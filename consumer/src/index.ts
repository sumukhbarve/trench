import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { Client } from "pg";
import { env } from "./env";
import { Event, compileSqrl, createSqrlInstance, runEvent } from "sqrl-helpers";
import { batchInsertEvents } from "./batchInsertEvents";
import format from "pg-format";

if (isMainThread) {
  for (let i = 0; i < 4; i++) {
    const worker = new Worker(__filename, {
      workerData: {
        isProductionWorker: i === 0,
        index: i,
      },
    });
  }
  const writerWorker = new Worker(__filename, {
    workerData: {
      isClickhouseWriter: true,
    },
  });

  console.log("Restarted consumers");
} else if (workerData.isClickhouseWriter) {
  console.log("Starting clickhouse writer");
  const client = new Client({
    connectionString: env.POSTGRES_URL,
  });

  async function writeEvents() {
    try {
      await client.connect();

      while (true) {
        // Sleep for 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const resCursor = await client.query(
          `
          SELECT "latestOutputLogId"
          FROM "OutputLogCursor"
          LIMIT 1;
        `
        );

        const latestOutputLogId = resCursor.rows[0]?.latestOutputLogId || null;

        const resOutputs = await client.query(
          `
          SELECT "id", "eventId", "datasetId", "data"
          FROM "OutputLog"
          WHERE "id" > $1
          OR $1 IS NULL
          ORDER BY "id" ASC
          LIMIT 1000;
        `,
          [latestOutputLogId]
        );

        const outputs = resOutputs.rows as {
          id: bigint;
          eventId: string;
          datasetId: bigint;
          data: any;
        }[];

        if (outputs.length === 0) {
          // No events to process, continue
          continue;
        }

        const eventData = outputs.map((event) => ({
          ...event.data,
          timestamp: new Date(event.data.timestamp),
        }));
        await batchInsertEvents(eventData);

        const newLastOutputId = outputs[outputs.length - 1]!.id;

        await client.query(
          `
          UPDATE "OutputLogCursor"
          SET "latestOutputLogId" = $1
        `,
          [newLastOutputId]
        );

        console.log(`Wrote ${outputs.length} events to Clickhouse`);
      }
    } catch (err) {
      console.error(err);
      // If an error occurs, rollback the transaction
    } finally {
      await client.end();
    }
  }

  writeEvents();
} else {
  const IS_PRODUCTION_WORKER = workerData.isProductionWorker;

  if (IS_PRODUCTION_WORKER) {
    console.log("Starting production worker");
  } else {
    console.log("Starting backfill worker");
  }

  const client = new Client({
    connectionString: env.POSTGRES_URL,
  });

  async function processEvents(props: {
    events: Event[];
    files: Record<string, string>;
    datasetId: bigint;
    isProductionWorker: boolean;
  }) {
    const { events, files, datasetId, isProductionWorker } = props;

    const results: Awaited<ReturnType<typeof runEvent>>[] = [];
    const instance = await createSqrlInstance({
      config: {
        "redis.address": process.env.REDIS_URL,
      },
    });

    const { executable } = await compileSqrl(instance, files);

    for (const event of events) {
      results.push(await runEvent(event, executable, datasetId));
    }

    const pushToDb = results.map((result) => ({
      eventId: result.id,
      datasetId: BigInt(result.datasetId),
      data: result,
    }));
    if (isProductionWorker) {
      pushToDb.push(
        ...results.map((result) => ({
          eventId: result.id,
          datasetId: BigInt(0),
          data: {
            ...result,
            datasetId: "0",
          },
        }))
      );
    }
    await client.query(
      format(
        `
      INSERT INTO "OutputLog" ("eventId", "datasetId", "data") VALUES %L
    `,
        pushToDb.map(({ eventId, datasetId, data }) => [
          eventId,
          datasetId,
          data,
        ])
      )
    );
  }

  async function getDatasetMetadata() {
    const res = IS_PRODUCTION_WORKER
      ? await client.query(`
      SELECT "Dataset"."id", "lastEventLogId", "backfillFrom", "backfillTo", "rules"
      FROM "Dataset"
      JOIN "DatasetJob" ON "DatasetJob"."datasetId" = "Dataset"."id"
      JOIN "ProductionDatasetLog" ON "ProductionDatasetLog"."datasetId" = "Dataset"."id"
      ORDER BY "ProductionDatasetLog"."createdAt" DESC
      FOR UPDATE OF "DatasetJob"
      SKIP LOCKED
      LIMIT 1
    `)
      : await client.query(`
      SELECT "Dataset"."id", "lastEventLogId", "backfillFrom", "backfillTo", "rules"
      FROM "Dataset"
      JOIN "DatasetJob" ON "DatasetJob"."datasetId" = "Dataset"."id"
      WHERE "Dataset"."id" > 0
      AND NOT EXISTS (
        SELECT FROM "ProductionDatasetLog"
        WHERE "ProductionDatasetLog"."datasetId" = "Dataset"."id"
      )
      ORDER BY RANDOM()
      FOR UPDATE OF "DatasetJob" 
      SKIP LOCKED
      LIMIT 1;
    `);

    if (res.rows.length === 0) {
      return null;
    }

    const numDatasets = res.rows.length;
    const randomIndex = Math.floor(Math.random() * numDatasets);
    const dataset = res.rows[randomIndex];

    type FileRow = { name: string; code: string };

    return dataset as {
      id: bigint;
      lastEventLogId: number;
      rules: FileRow[];
    };
  }

  async function initConsumer() {
    try {
      await client.connect();

      while (true) {
        // Sleep for 1 second
        await new Promise((resolve) =>
          setTimeout(resolve, IS_PRODUCTION_WORKER ? 1000 : 1000)
        );

        // Start a transaction
        await client.query("BEGIN");

        const res = await client.query(`
        SELECT "Dataset"."id", "lastEventLogId", "backfillFrom", "backfillTo", "Release"."code"
        FROM "Dataset"
        JOIN "Release" ON "Release"."id" = "Dataset"."releaseId"
        FOR UPDATE SKIP LOCKED
        LIMIT 1;
      `);
        if (res.rows.length === 0) {
          await client.query("COMMIT");
          continue;
        }

        const {
          id: datasetId,
          lastEventLogId,
          code,
        } = dataset as {
          id: bigint;
          lastEventLogId: number;
          code: Record<string, string>;
        };

        const eventsRes = await client.query(
          `
          SELECT "id", "type", "data", "timestamp"
          FROM "EventLog"
          WHERE "id" > $1
          OR $1 IS NULL
          ORDER BY "id" ASC
          LIMIT 1000;
        `,
          [lastEventLogId]
        );

        const events = (eventsRes.rows as Event[]).map((row) => ({
          ...row,
          timestamp: row.timestamp.toISOString(),
        }));

        if (events.length === 0) {
          // No events to process, commit the transaction and continue
          await client.query("COMMIT");
          continue;
        }

        await processEvents(events, code, datasetId);

        const newLastEventId = events.length
          ? events[events.length - 1]!.id
          : lastEventLogId;

        await client.query(
          `
          UPDATE "Dataset"
          SET "lastEventLogId" = $1
          WHERE id = $2;
        `,
          [newLastEventId, datasetId]
        );
        // if (IS_PRODUCTION_WORKER) {
        //   await client.query(
        //     `
        //     UPDATE "DatasetJob"
        //     SET "lastProductionEventLogId" = $1
        //     WHERE "datasetId" = 0;
        //   `,
        //     [newLastEventId, datasetId]
        //   );
        // }

        // Commit the transaction
        await client.query("COMMIT");

        console.log(
          `Processed ${events.length} events for dataset ${datasetId}`,
          IS_PRODUCTION_WORKER ? "(prod)" : "(backfill)"
        );
      }
    } catch (err) {
      console.error(err);
      // If an error occurs, rollback the transaction
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  }

  initConsumer();
}
