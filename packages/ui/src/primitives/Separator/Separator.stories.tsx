import { Themes } from "../../stories/helpers";
import { Separator } from "./Separator";

export default { title: "Primitives/Separator" };

const Sample = () => (
  <div className="flex flex-col gap-3 text-small">
    <span>Above</span>
    <Separator />
    <div className="flex h-6 items-center gap-3">
      <span>Left</span>
      <Separator orientation="vertical" />
      <span>Right</span>
    </div>
  </div>
);
export const Default = () => <Sample />;
export const LightAndDark = () => (
  <Themes>
    <Sample />
  </Themes>
);
