import { Themes } from "../../stories/helpers";
import { Skeleton } from "./Skeleton";

export default { title: "Primitives/Skeleton" };

const Block = () => (
  <div
    aria-busy="true"
    aria-label="Loading sample content"
    role="group"
    className="flex w-72 flex-col gap-3"
  >
    <Skeleton className="h-6 w-1/2" />
    <Skeleton className="h-4" />
    <Skeleton className="h-4 w-5/6" />
  </div>
);
export const Default = () => <Block />;
export const Loading = () => <Block />;
export const LightAndDark = () => (
  <Themes>
    <Block />
  </Themes>
);
