import { format } from "date-fns";
import { api } from "../utils/api";
import {
  DateRangePicker,
  EntityLabelFilter,
  EntityTypeFilter,
  EventLabelFilter,
  EventTypeFilter,
  useEventFilters,
} from "../components/Filters";
import { Box, HStack, Heading, Tabs, VStack } from "@chakra-ui/react";
import { Navbar } from "../components/Navbar";
import { TopList } from "../components/TopList";
import {
  ArrayParam,
  NumberParam,
  StringParam,
  useQueryParam,
} from "use-query-params";
import { EntityTimeChart } from "../components/EntityTimeChart";
import { EventTimeChart } from "../components/EventTimeChart";
import { EventLabelDistribution } from "../components/EventLabelDistribution";
import { EntityLabelDistribution } from "../components/EntityLabelDistribution";
import { useEffect, useMemo } from "react";
import {
  Metric,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Text,
  Title,
} from "@tremor/react";

function EntitiesPage() {
  const { data: entityLabels } = api.labels.getEntityLabels.useQuery();
  const { data: entityTypes } = api.labels.getEntityTypes.useQuery();

  const [entityType] = useQueryParam("entityType", StringParam);
  const eventFilters = useEventFilters();
  const [paramEntityLabels] = useQueryParam("entityLabel", ArrayParam);

  const sortedEntityTypes = useMemo(() => {
    if (!entityTypes) {
      return [];
    }
    return entityTypes.sort((a, b) => {
      // make sure User is first
      if (a.name === "User") {
        return -1;
      }
      if (b.name === "User") {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [entityTypes]);

  return (
    <div className="p-8 flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Text>Search across</Text>
        <EventTypeFilter />
      </div>
      {sortedEntityTypes?.map((entityType, idx) => {
        return (
          <div key={idx}>
            <Title>Entity: {entityType.name}</Title>
            <div className="h-4"></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-4">
                <EntityLabelDistribution
                  title={`Labels of ${
                    entityType ? `${entityType.name} ` : ""
                  }Entities`}
                  entityFilters={{
                    entityType: entityType.id,
                  }}
                />
                <TopList
                  title={`${
                    entityType ? `${entityType.name} ` : ""
                  } Entities with the most ${
                    eventFilters.eventType
                      ? `\`${eventFilters.eventType}\` `
                      : ""
                  }Events`}
                  entityTitle={entityType.name ?? ""}
                  countTitle={"Events"}
                  args={{
                    limit: 5,
                    entityFilters: {
                      entityType: entityType.id,
                    },
                  }}
                />
              </div>
              <div className="col-span-2">
                {!paramEntityLabels?.length && (
                  <EntityTimeChart
                    title={`Unique ${
                      entityType ? `${entityType.name} ` : ""
                    }Entities Seen`}
                    color="neutral"
                    entityFilters={{
                      entityType: entityType.id,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventsPage() {
  const filters = useEventFilters();

  const { data: eventTypes } = api.labels.getEventTypes.useQuery();

  return (
    <>
      <div className="p-8 flex flex-col gap-8">
        {eventTypes?.map((eventType, idx) => {
          return (
            <div key={idx}>
              <Metric>Event: {eventType.name}</Metric>
              <div className="h-4"></div>
              <div className="grid grid-cols-3 gap-4">
                <VStack>
                  <EventLabelDistribution
                    title="Event Labels"
                    eventFilters={{
                      eventType: eventType.id,
                    }}
                  />
                </VStack>
                <div className="col-span-2">
                  <EventTimeChart
                    title="All Events"
                    color="neutral"
                    eventFilters={{
                      eventType: eventType.id,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
export default function Dashboard() {
  const filters = useEventFilters();

  const startDateString = filters.dateRange?.start
    ? format(new Date(filters.dateRange.start), "M/d")
    : undefined;
  const endDateString = filters.dateRange?.end
    ? format(new Date(filters.dateRange.end), "M/d")
    : undefined;

  const [tab, setTab] = useQueryParam("tab", NumberParam);
  const [entityType, setEntityType] = useQueryParam("entityType", StringParam);
  const [eventType, setEventType] = useQueryParam("eventType", StringParam);
  const [eventLabels, setEventLabels] = useQueryParam("eventLabel", ArrayParam);
  const [entityLabels, setEntityLabels] = useQueryParam(
    "entityLabel",
    ArrayParam
  );
  useEffect(() => {
    if (tab === 0) {
      setEntityType(undefined);
      setEntityLabels(undefined);
    }
  }, [setEntityType, setEntityLabels, tab]);

  return (
    <div>
      <Navbar />
      <div className="p-4 gap-8 flex justify-start items-end">
        <Metric>
          <b>
            {startDateString} - {endDateString},{" "}
          </b>
          <span className="">
            {eventType ? `\`${eventType}\` events` : "all events"}
            {eventLabels?.length
              ? ` with labels: ${eventLabels
                  .map((label) => `\`${label}\``)
                  .join(", ")}`
              : ""}
            {entityType || entityLabels?.length
              ? `, related to ${entityType ? `\`${entityType}\`` : "entities"}`
              : ""}
            {entityLabels?.length
              ? ` with labels: ${entityLabels
                  .map((label) => `\`${label}\``)
                  .join(", ")}`
              : ""}
          </span>
        </Metric>
      </div>
      <div className="px-4 pb-4 flex gap-4">
        <DateRangePicker />
      </div>

      <TabGroup isLazy index={tab ?? 0} onChange={setTab}>
        <TabList className="px-8">
          <Tab>Events</Tab>
          <Tab>Entities</Tab>
        </TabList>
        <TabPanels>
          <TabPanel p={0}>
            <EventsPage />
          </TabPanel>
          <TabPanel p={0}>
            <EntitiesPage />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
