import { Themes } from "../../stories/helpers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

export default { title: "Primitives/Tabs" };

const Sample = ({ disabled = false }: { disabled?: boolean }) => (
  <Tabs defaultValue="overview" className="w-96">
    <TabsList aria-label="Sample sections">
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="news">News</TabsTrigger>
      <TabsTrigger value="filings" disabled={disabled}>
        Filings
      </TabsTrigger>
    </TabsList>
    <TabsContent value="overview">Overview panel (sample content)</TabsContent>
    <TabsContent value="news">News panel (sample content)</TabsContent>
    <TabsContent value="filings">Filings panel (sample content)</TabsContent>
  </Tabs>
);
export const Default = () => <Sample />;
export const Disabled = () => <Sample disabled />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
