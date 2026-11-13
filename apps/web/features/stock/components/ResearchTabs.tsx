import { Tabs, TabsContent, TabsList, TabsTrigger } from "@aroma/ui";
import type { ResearchView } from "../schema";
import { NewsList } from "./NewsList";
import {
  EventsPanel,
  FinancialsPanel,
  OverviewPanel,
  TechnicalsPanel,
} from "./ResearchPanels";

/**
 * Server component composing the client Tabs primitive: panel content is rendered on the server
 * and passed in, so only Base UI's tab behaviour ships as JavaScript.
 */
export function ResearchTabs({ research }: { research: ResearchView }) {
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      body: <OverviewPanel research={research} />,
    },
    {
      id: "technicals",
      label: "Technicals",
      body: <TechnicalsPanel research={research} />,
    },
    {
      id: "financials",
      label: "Financials",
      body: <FinancialsPanel research={research} />,
    },
    {
      id: "events",
      label: "Events",
      body: <EventsPanel research={research} />,
    },
    { id: "news", label: "News", body: <NewsList news={research.news} /> },
  ];
  return (
    <Tabs defaultValue="overview">
      <TabsList aria-label="Company research" className="overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {tab.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}
